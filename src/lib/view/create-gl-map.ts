import { untrack } from "svelte";
import { Map as MaptilerMap, MapStyle, config as maptilerConfig } from "@maptiler/sdk";
import type { StyleSpecification } from "@maptiler/sdk";
import type { BasemapConfig } from "../core/basemap.svelte.js";
import type { MapContext } from "../core/create-map.svelte.js";
import type { GlMapLike } from "../core/gl.js";
import { themeSignature } from "../plugins/style.js";

/**
 * Calls `onChange` when the host's theme changes the tokens map colors are read from: on a
 * `prefers-color-scheme` change, or a `data-theme`, `class`, or `style` change on `<html>`.
 * Changes that leave the tokens on `container` as they were (e.g. a scroll lock's inline style)
 * are ignored. Returns the stop function.
 */
export function watchTheme(container: Element, onChange: () => void): () => void {
	let last = themeSignature(container);
	const check = () => {
		const next = themeSignature(container);
		if (next === last) return;
		last = next;
		onChange();
	};
	const media = matchMedia("(prefers-color-scheme: dark)");
	media.addEventListener("change", check);
	const observer = new MutationObserver(check);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "class", "style"]
	});
	return () => {
		media.removeEventListener("change", check);
		observer.disconnect();
	};
}

/** Today's live map: MapTiler Streets v4 and its variants, without the busy POI label layers. */
export function defaultBasemaps(): BasemapConfig {
	const streets = MapStyle.STREETS_V4;
	return {
		// Style URLs, not variant objects: the basemap fallback matches a failed style by its URL.
		styles: streets.getVariants().map((v) => ({ id: v.getId(), style: v.getExpandedStyleURL() })),
		defaultId: streets.getDefaultVariant().getId(),
		excludedLayers: ["Sport", "Tourism", "Culture", "Shopping", "Food", "Transport"]
	};
}

/**
 * A `transformRequest` that adds `key` to MapTiler API requests that have none. The SDK's own
 * transform runs after it and only adds its global `config.apiKey` when `key` is missing, so
 * each map's requests carry its own key, and two maps with different keys don't clash.
 */
export function maptilerKeyTransform(key: string): (url: string) => { url: string } {
	return (url) => {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return { url };
		}
		if (parsed.host !== maptilerConfig.apiHost || parsed.searchParams.has("key")) return { url };
		parsed.searchParams.append("key", key);
		return { url: parsed.href };
	};
}

type SetStyle = MaptilerMap["setStyle"];
/**
 * A private field of MapTiler's `Map` (SDK 4.2). `GlMap` depends on 4.2 internals (this field and
 * `setStyle(null)`'s fallback), which is why package.json pins `~4.2.0`: re-check both on any SDK
 * upgrade.
 */
type SpaceboxLoadingState = { styleLoadedCallbackFired: boolean };

/** MapLibre's own `setStyle`, which MapTiler's `Map` overrides. */
const clearStyle = (Object.getPrototypeOf(MaptilerMap.prototype) as { setStyle: SetStyle })
	.setStyle;

/**
 * MapLibre's `remove()` clears the style with `setStyle(null)`. MapTiler's `setStyle` turns
 * `null` into its default Streets style when no style has loaded yet, so removing a map that is
 * still loading (hiding it quickly) would request that style for nothing; and once one has
 * loaded it keeps it, so the style's requests and worker sources outlive the map. `null` goes to
 * MapLibre's `setStyle` instead (nothing else here passes `null`), and MapTiler's pending
 * space and halo setup, which would read the cleared style, is marked done.
 */
class GlMap extends MaptilerMap {
	override setStyle(...args: Parameters<SetStyle>): this {
		if (args[0] !== null) return super.setStyle(...args);
		const pending = (this as unknown as { spaceboxLoadingState?: SpaceboxLoadingState })
			.spaceboxLoadingState;
		if (pending) pending.styleLoadedCallbackFired = true;
		return clearStyle.apply(this, args) as this;
	}
}

/** The style of `ctx`'s current basemap. Throws when there is none, rather than letting MapTiler fall back to its own default style. */
function styleOf(ctx: MapContext): string | StyleSpecification {
	const id = ctx.basemap.current;
	const entry = ctx.config.basemaps?.styles.find((s) => s.id === id);
	if (!entry) throw new Error(`map-sdk: no basemap style for "${id}"`);
	return entry.style as string | StyleSpecification;
}

function recordView(gl: MaptilerMap, ctx: MapContext): void {
	const center = gl.getCenter();
	const bounds = gl.getBounds();
	ctx.updateView(
		{
			center: [center.lng, center.lat],
			zoom: gl.getZoom(),
			bearing: gl.getBearing(),
			pitch: gl.getPitch()
		},
		{
			west: bounds.getWest(),
			south: bounds.getSouth(),
			east: bounds.getEast(),
			north: bounds.getNorth()
		}
	);
}

/**
 * Creates the MapTiler map for `ctx` in `container`, at `ctx`'s camera with its current basemap.
 * Reads `ctx` untracked, so calling this in an effect doesn't make it depend on the camera or
 * basemap. Records the camera and bounds once the map loads and after every move.
 */
export function createGlMap(container: HTMLElement, ctx: MapContext): GlMapLike {
	const { camera, style } = untrack(() => ({ camera: ctx.camera, style: styleOf(ctx) }));
	const gl = new GlMap({
		container,
		style,
		center: camera.center,
		zoom: camera.zoom,
		bearing: camera.bearing,
		pitch: camera.pitch,
		// The key goes on each request, not on the SDK's global config (the `apiKey` option
		// sets that global).
		transformRequest: maptilerKeyTransform(ctx.config.maptilerKey),
		cooperativeGestures: ctx.config.cooperativeGestures ?? false,
		keyboard: true,
		// MapView draws its own controls and attribution.
		forceNoAttributionControl: true,
		navigationControl: false,
		geolocateControl: false,
		logSDKVersion: false
	});
	gl.on("load", () => recordView(gl, ctx));
	gl.on("moveend", () => recordView(gl, ctx));
	return gl;
}
