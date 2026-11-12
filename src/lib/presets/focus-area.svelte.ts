import type { Feature, FeatureCollection } from "geojson";
import { untrack } from "svelte";
import type { FeatureListItem, MapPlugin, PluginContext } from "../core/plugin.js";
import { NO_LEVEL } from "../data/scale.js";
import { hitFromProps } from "../plugins/shared.js";
import { themeColors } from "../plugins/style.js";
import { assertFocusGeometry, worldMask, type FocusGeometry } from "./focus-geometry.js";

export type { FocusGeometry } from "./focus-geometry.js";

export interface FocusAreaPluginOptions {
	/** Default "focus-area". */
	id?: string;
	/** Already-translated layer name: the point's group in the list and summary. */
	layerLabel: string;
	/** Default null (nothing drawn). */
	geometry?: FocusGeometry | null;
	/** A point's label ("Your location", a school's name). Ignored for a polygon. */
	label?: string;
}

export interface FocusAreaPlugin extends MapPlugin {
	/** Replaces the geometry and label. Throws like the options, keeping the last focus. */
	set(focus: { geometry: FocusGeometry | null; label?: string }): void;
	/** The current focus. Reactive. (`label` on the plugin itself is the layer's name.) */
	readonly focus: { readonly geometry: FocusGeometry | null; readonly label: string | undefined };
}

// From sjvair.com's pesticides and emissions explorers (the spec's starting values).
const LINE_WIDTH = 2.5;
const CASING_WIDTH = LINE_WIDTH + 3;
const LINE_OPACITY = 0.9;
const WASH_OPACITY = 0.55;
const RING_RADIUS = 13;
const RING_WIDTH = 3;
/** The casing reaches 1.5px past the ring on each side (MapLibre strokes outside the radius). */
const RING_CASING_INSET = 1.5;
const LABEL_SIZE = 12;
/** In ems: clear of the ring (its outer edge is 16px from the center). */
const LABEL_OFFSET: [number, number] = [1.5, 0];
const LABEL_HALO = 2;

const collection = (features: Feature[]): FeatureCollection => ({
	type: "FeatureCollection",
	features
});
const feature = (
	geometry: Feature["geometry"],
	properties: Feature["properties"] = {}
): Feature => ({
	type: "Feature",
	geometry,
	properties
});

/**
 * The place a map is about. An area (Polygon or MultiPolygon) gets a two-tone outline and a wash
 * over everything outside it; it isn't listed, clicked, or hovered. A place (Point) gets a
 * two-tone ring with its `label` beside it, and is one feature-list row, named by the label,
 * whose click pins a card with the label alone; it is never selectable.
 *
 * Add it first (or `before` the first data plugin), so the data draws over it. Change the focus
 * with `set`, which keeps the plugin and its draw-order slot. The colors are fixed (a slate line
 * on a white casing, a white wash), so they read on any basemap whatever the page's theme; set
 * the `--focus-area`, `--focus-area-casing`, and `--focus-area-wash` tokens to change them. The label is drawn on
 * the map's canvas, so screen readers hear the list row instead; a map with no feature list
 * should name the place in `MapView`'s `label`.
 */
export function focusAreaPlugin(options: FocusAreaPluginOptions): FocusAreaPlugin {
	const pluginId = options.id ?? "focus-area";
	const { layerLabel } = options;
	assertFocusGeometry(options.geometry ?? null);
	let focus = $state.raw<{ geometry: FocusGeometry | null; label: string | undefined }>({
		geometry: options.geometry ?? null,
		label: options.label
	});

	const refKey = `feature:${pluginId}`;

	function setup(ctx: PluginContext): () => void {
		const { gl } = ctx;
		const container = gl.getCanvas().closest?.("[data-mapsdk-map]") ?? null;
		const theme = themeColors(container);
		const empty = collection([]);
		const area = ctx.addSource("area", { type: "geojson", data: empty });
		const mask = ctx.addSource("mask", { type: "geojson", data: empty });
		const point = ctx.addSource("point", { type: "geojson", data: empty });
		const round = { "line-join": "round", "line-cap": "round" } as const;
		ctx.addLayer("wash", {
			type: "fill",
			source: mask,
			paint: { "fill-color": theme.focusAreaWash, "fill-opacity": WASH_OPACITY }
		});
		ctx.addLayer("casing", {
			type: "line",
			source: area,
			layout: round,
			paint: {
				"line-color": theme.focusAreaCasing,
				"line-width": CASING_WIDTH,
				"line-opacity": LINE_OPACITY
			}
		});
		ctx.addLayer("line", {
			type: "line",
			source: area,
			layout: round,
			paint: {
				"line-color": theme.focusArea,
				"line-width": LINE_WIDTH,
				"line-opacity": LINE_OPACITY
			}
		});
		const ringCasing = ctx.addLayer("ring-casing", {
			type: "circle",
			source: point,
			paint: {
				"circle-radius": RING_RADIUS - RING_CASING_INSET,
				"circle-opacity": 0,
				"circle-stroke-width": RING_WIDTH + 2 * RING_CASING_INSET,
				"circle-stroke-color": theme.focusAreaCasing,
				"circle-stroke-opacity": LINE_OPACITY
			}
		});
		const ring = ctx.addLayer("ring", {
			type: "circle",
			source: point,
			paint: {
				"circle-radius": RING_RADIUS,
				"circle-opacity": 0,
				"circle-stroke-width": RING_WIDTH,
				"circle-stroke-color": theme.focusArea,
				"circle-stroke-opacity": LINE_OPACITY
			}
		});
		ctx.addLayer("label", {
			type: "symbol",
			source: point,
			layout: {
				"text-field": ["get", "name"],
				"text-anchor": "left",
				"text-offset": LABEL_OFFSET,
				"text-size": LABEL_SIZE,
				"text-allow-overlap": true,
				"text-ignore-placement": true
			},
			paint: {
				"text-color": theme.focusArea,
				"text-halo-color": theme.focusAreaCasing,
				"text-halo-width": LABEL_HALO
			}
		});
		ctx.interactive([ringCasing, ring], (props) => hitFromProps(pluginId, props));

		const setData = (id: string, data: FeatureCollection) =>
			(gl.getSource(id) as { setData(d: FeatureCollection): void }).setData(data);

		ctx.effect(() => {
			const { geometry, label } = focus;
			untrack(() => {
				// Plain objects: MapLibre structured-clones the data to its worker.
				const g = $state.snapshot(geometry) as FocusGeometry | null;
				const isArea = g?.type === "Polygon" || g?.type === "MultiPolygon";
				setData(area, collection(isArea ? [feature(g)] : []));
				setData(mask, collection(isArea ? [feature(worldMask(g))] : []));
				setData(
					point,
					collection(g?.type === "Point" ? [feature(g, { refKey, name: label ?? layerLabel })] : [])
				);
			});
		});

		return () => {};
	}

	function features(): FeatureListItem[] {
		const { geometry, label } = focus;
		if (geometry?.type !== "Point") return [];
		const [lng, lat] = geometry.coordinates;
		return [
			{
				refKey,
				ref: { kind: "feature", id: pluginId },
				name: label ?? layerLabel,
				value: null,
				level: NO_LEVEL,
				units: "",
				lngLat: [lng, lat],
				selectable: false,
				noReading: true
			}
		];
	}

	return {
		id: pluginId,
		features,
		label: layerLabel,
		selectable: false,
		setup,
		get focus() {
			return focus;
		},
		set(next) {
			assertFocusGeometry(next.geometry);
			focus = { geometry: next.geometry, label: next.label };
		}
	};
}
