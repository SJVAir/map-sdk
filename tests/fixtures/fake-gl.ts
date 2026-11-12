import type { CustomLayerInterface, LayerSpecification, SourceSpecification } from "@maptiler/sdk";
import type { GlMapLike } from "../../src/lib/core/gl.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- event payloads are untyped, as in MapLibre */
type Listener = (e: any) => void;
type Rendered = ReturnType<GlMapLike["queryRenderedFeatures"]>[number];

export interface FakeGl extends GlMapLike {
	styleLoaded: boolean;
	/**
	 * Basemap tiles still loading: `isStyleLoaded()` says false although the style itself is
	 * loaded (adding sources and layers works), as MapLibre's does right after `style.load`.
	 */
	tilesLoading: boolean;
	/** Specs as added; a `setData` through `getSource(id)` replaces the spec's `data`. */
	readonly sources: Map<string, SourceSpecification>;
	/** In draw order. */
	readonly layers: Array<LayerSpecification | CustomLayerInterface>;
	readonly images: Map<string, HTMLImageElement | ImageData>;
	readonly featureStates: Map<string, Record<string, unknown>>;
	readonly listeners: Array<{ type: string; layerId?: string; listener: Listener }>;
	/** Every GlMapLike call, as `method:firstArg`. */
	readonly calls: string[];
	/** Every `easeTo`, `flyTo`, and `fitBounds`, with its options. */
	readonly moves: Array<{ method: "easeTo" | "flyTo" | "fitBounds"; options: any }>;
	/** The one canvas `getCanvas()` returns: a real `EventTarget`, so DOM listeners work. */
	readonly canvas: HTMLCanvasElement;
	/** Calls listeners for `type` (with `layerId`, only those registered on that layer). */
	emit(type: string, e?: unknown, layerId?: string): void;
	/** Marks the style loaded and emits `style.load`. */
	fireStyleLoad(): void;
	/** What `queryRenderedFeatures` returns (filtered by `options.layers`). */
	setRenderedFeatures(features: Rendered[]): void;
}

/**
 * An in-memory `GlMapLike`. Strict where MapLibre is: adding a source or layer before the style
 * is loaded, a duplicate id, a layer on a missing source, or removing a source a layer still uses
 * all throw.
 */
export function createFakeGl(opts: { styleLoaded?: boolean } = {}): FakeGl {
	const sources = new Map<string, SourceSpecification>();
	const layers: Array<LayerSpecification | CustomLayerInterface> = [];
	const images = new Map<string, HTMLImageElement | ImageData>();
	const featureStates = new Map<string, Record<string, unknown>>();
	const listeners: FakeGl["listeners"] = [];
	const calls: string[] = [];
	const moves: FakeGl["moves"] = [];
	let rendered: Rendered[] = [];
	let center = { lng: -119.7, lat: 36.7 };
	let zoom = 7;
	let bearing = 0;
	let pitch = 0;
	let removed = false;
	const canvas = Object.assign(new EventTarget(), { style: {} }) as unknown as HTMLCanvasElement;

	function log(method: string, arg?: unknown) {
		if (removed) throw new Error(`fake-gl: ${method} after remove()`);
		calls.push(arg === undefined ? method : `${method}:${String(arg)}`);
	}
	function requireStyle(method: string) {
		if (!gl.styleLoaded) throw new Error(`fake-gl: ${method} before the style is loaded`);
	}
	const stateKey = (source: string, id: string | number) => `${source}/${id}`;

	const gl: FakeGl = {
		styleLoaded: opts.styleLoaded ?? false,
		tilesLoading: false,
		sources,
		layers,
		images,
		featureStates,
		listeners,
		calls,
		moves,
		canvas,

		addSource(id, source) {
			log("addSource", id);
			requireStyle("addSource");
			if (sources.has(id)) throw new Error(`fake-gl: source ${id} exists`);
			sources.set(id, source);
		},
		removeSource(id) {
			log("removeSource", id);
			if (!sources.has(id)) throw new Error(`fake-gl: no source ${id}`);
			const user = layers.find((l) => "source" in l && l.source === id);
			if (user) throw new Error(`fake-gl: layer ${user.id} still uses source ${id}`);
			sources.delete(id);
		},
		getSource(id) {
			log("getSource", id);
			if (!sources.has(id)) return undefined;
			// The part of a GeoJSONSource that plugins use.
			return {
				setData(data: unknown) {
					log("setData", id);
					const spec = sources.get(id);
					if (!spec) throw new Error(`fake-gl: setData on removed source ${id}`);
					sources.set(id, { ...spec, data } as SourceSpecification);
				}
			};
		},
		addLayer(layer, beforeId) {
			log("addLayer", layer.id);
			requireStyle("addLayer");
			if (layers.some((l) => l.id === layer.id))
				throw new Error(`fake-gl: layer ${layer.id} exists`);
			if ("source" in layer && typeof layer.source === "string" && !sources.has(layer.source)) {
				throw new Error(`fake-gl: layer ${layer.id} uses missing source ${layer.source}`);
			}
			const at = beforeId === undefined ? -1 : layers.findIndex((l) => l.id === beforeId);
			if (beforeId !== undefined && at < 0) throw new Error(`fake-gl: no layer ${beforeId}`);
			if (at < 0) layers.push(layer);
			else layers.splice(at, 0, layer);
		},
		moveLayer(id, beforeId) {
			log("moveLayer", id);
			const from = layers.findIndex((l) => l.id === id);
			if (from < 0) throw new Error(`fake-gl: no layer ${id}`);
			if (beforeId !== undefined && !layers.some((l) => l.id === beforeId)) {
				throw new Error(`fake-gl: no layer ${beforeId}`);
			}
			const [layer] = layers.splice(from, 1);
			const at = beforeId === undefined ? -1 : layers.findIndex((l) => l.id === beforeId);
			if (at < 0) layers.push(layer);
			else layers.splice(at, 0, layer);
		},
		removeLayer(id) {
			log("removeLayer", id);
			const at = layers.findIndex((l) => l.id === id);
			if (at < 0) throw new Error(`fake-gl: no layer ${id}`);
			layers.splice(at, 1);
		},
		getLayer(id) {
			log("getLayer", id);
			return layers.find((l) => l.id === id);
		},
		addImage(id, image) {
			log("addImage", id);
			if (images.has(id)) throw new Error(`fake-gl: image ${id} exists`);
			images.set(id, image);
		},
		hasImage(id) {
			log("hasImage", id);
			return images.has(id);
		},
		removeImage(id) {
			log("removeImage", id);
			if (!images.delete(id)) throw new Error(`fake-gl: no image ${id}`);
		},
		setFeatureState(target, state) {
			log("setFeatureState", target.source);
			const key = stateKey(target.source, target.id);
			featureStates.set(key, { ...featureStates.get(key), ...state });
		},
		setLayoutProperty(layerId, name, value) {
			log("setLayoutProperty", layerId);
			const layer = layers.find((l) => l.id === layerId);
			if (!layer) throw new Error(`fake-gl: no layer ${layerId}`);
			const spec = layer as { layout?: Record<string, unknown> };
			spec.layout = { ...spec.layout, [name]: value };
		},
		removeFeatureState(target, key) {
			log("removeFeatureState", target.source);
			for (const k of [...featureStates.keys()]) {
				if (
					target.id === undefined
						? !k.startsWith(`${target.source}/`)
						: k !== stateKey(target.source, target.id)
				) {
					continue;
				}
				if (key === undefined) featureStates.delete(k);
				else delete featureStates.get(k)![key];
			}
		},
		queryRenderedFeatures(point, options) {
			log("queryRenderedFeatures");
			const only = options?.layers;
			return only ? rendered.filter((f) => only.includes(f.layer.id)) : [...rendered];
		},
		isStyleLoaded() {
			log("isStyleLoaded");
			return gl.styleLoaded && !gl.tilesLoading;
		},
		setStyle(_style, options) {
			log("setStyle", options?.diff === false ? "nodiff" : "diff");
			// A new style drops every source, layer, and image.
			sources.clear();
			layers.length = 0;
			images.clear();
			featureStates.clear();
			gl.styleLoaded = false;
		},
		on(type: string, a: string | Listener, b?: Listener) {
			log("on", type);
			if (typeof a === "function") listeners.push({ type, listener: a });
			else listeners.push({ type, layerId: a, listener: b! });
		},
		off(type: string, a: string | Listener, b?: Listener) {
			log("off", type);
			const layerId = typeof a === "function" ? undefined : a;
			const listener = typeof a === "function" ? a : b!;
			const at = listeners.findIndex(
				(l) => l.type === type && l.layerId === layerId && l.listener === listener
			);
			if (at >= 0) listeners.splice(at, 1);
		},
		getBounds() {
			log("getBounds");
			const span = 360 / 2 ** zoom;
			return {
				getWest: () => center.lng - span,
				getSouth: () => center.lat - span / 2,
				getEast: () => center.lng + span,
				getNorth: () => center.lat + span / 2
			};
		},
		getCenter() {
			log("getCenter");
			return { ...center };
		},
		getZoom() {
			log("getZoom");
			return zoom;
		},
		getBearing() {
			log("getBearing");
			return bearing;
		},
		getPitch() {
			log("getPitch");
			return pitch;
		},
		easeTo(o) {
			log("easeTo");
			moves.push({ method: "easeTo", options: o });
			if (o.center) center = { lng: o.center[0], lat: o.center[1] };
			if (o.zoom !== undefined) zoom = o.zoom;
		},
		flyTo(o) {
			log("flyTo");
			moves.push({ method: "flyTo", options: o });
			if (o.center) center = { lng: o.center[0], lat: o.center[1] };
			if (o.zoom !== undefined) zoom = o.zoom;
		},
		fitBounds(b, o) {
			log("fitBounds");
			moves.push({ method: "fitBounds", options: { bounds: b, ...o } });
		},
		jumpTo(o) {
			log("jumpTo");
			if (o.center) center = { lng: o.center[0], lat: o.center[1] };
			if (o.zoom !== undefined) zoom = o.zoom;
			if (o.bearing !== undefined) bearing = o.bearing;
			if (o.pitch !== undefined) pitch = o.pitch;
		},
		project(lngLat) {
			log("project");
			return { x: lngLat[0], y: lngLat[1] };
		},
		unproject(point) {
			log("unproject");
			return { lng: point[0], lat: point[1] };
		},
		getCanvas() {
			log("getCanvas");
			return canvas;
		},
		remove() {
			log("remove");
			removed = true;
		},

		emit(type, e = {}, layerId) {
			for (const l of [...listeners]) {
				if (l.type === type && l.layerId === layerId) l.listener(e);
			}
		},
		fireStyleLoad() {
			gl.styleLoaded = true;
			gl.emit("style.load");
		},
		setRenderedFeatures(features) {
			rendered = features;
		}
	};
	return gl;
}
