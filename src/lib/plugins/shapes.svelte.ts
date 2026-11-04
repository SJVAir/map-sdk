import type { ExpressionSpecification } from "@maptiler/sdk";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { untrack } from "svelte";
import type { FeatureListItem, MapPlugin, PluginContext } from "../core/plugin.js";
import { decodeRef, selectionId } from "../data/refs.js";
import { levelFor, NO_LEVEL } from "../data/scale.js";
import type { Scale } from "../data/scale-types.js";
import type { DataSource, MapFeatureProperties } from "../data/types.js";
import {
	createScaleResolver,
	NO_SCALE,
	scaleKey,
	type Resolved
} from "./scale-resolution.svelte.js";
import { hitFromProps, SELECTED_OPACITY } from "./shared.js";
import { asDataURI, SELECTED_OVERLAY_PADDING, selectedOverlay } from "./icons.js";
import { colorExpression, opacityExpression, themeColors, type ThemeColors } from "./style.js";

export interface ShapesOptions<P extends MapFeatureProperties> {
	id: string;
	source: DataSource<P>;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	/** `choropleth` fills by the source's scale; `plain` is neutral with no legend. */
	mode: "plain" | "choropleth";
	selectable?: boolean;
	/** Whether `features()` lists this plugin's features. Default true. */
	listed?: boolean;
	/** Fill opacity where a level sets none. Default 0.6. */
	fillOpacity?: number;
}

/** The check image is drawn at this multiple of its size and scaled down, for sharp HiDPI. */
const IMAGE_RATIO = 2;
/** The check mark badge is sized for a marker this many pixels across. */
const CHECK_SIZE = 12;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const DEFAULT_FILL_OPACITY = 0.6;
const OUTLINE_WIDTH = 1;
const LINE_WIDTH = 2;
const SELECTED_WIDTH = 3;
const LINE_TYPES = ["LineString", "MultiLineString"];

/** Twice the signed area of a ring, absolute. */
function ringArea(ring: Position[]): number {
	let sum = 0;
	for (let i = 0; i < ring.length - 1; i++) {
		sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
	}
	return Math.abs(sum);
}

/** Centroid of a ring (the area-weighted one; the vertex mean for a degenerate ring). */
function ringCentroid(ring: Position[]): [number, number] {
	let area = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < ring.length - 1; i++) {
		const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
		area += cross;
		cx += (ring[i][0] + ring[i + 1][0]) * cross;
		cy += (ring[i][1] + ring[i + 1][1]) * cross;
	}
	if (area === 0) {
		const n = Math.max(ring.length - 1, 1);
		const sum = ring.slice(0, n).reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
		return [sum[0] / n, sum[1] / n];
	}
	return [cx / (3 * area), cy / (3 * area)];
}

/** The point used to place a feature in lists: its largest ring's centroid, or a line's midpoint. */
export function labelPoint(geometry: Geometry): [number, number] | null {
	switch (geometry.type) {
		case "Point":
			return [geometry.coordinates[0], geometry.coordinates[1]];
		case "Polygon":
		case "MultiPolygon": {
			const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
			let best: Position[] | null = null;
			let bestArea = -1;
			for (const polygon of polygons) {
				const outer = polygon[0];
				if (!outer?.length) continue;
				const area = ringArea(outer);
				if (area > bestArea) {
					best = outer;
					bestArea = area;
				}
			}
			return best ? ringCentroid(best) : null;
		}
		case "LineString":
		case "MultiLineString": {
			const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
			const longest = lines.reduce<Position[]>((a, b) => (b.length > a.length ? b : a), []);
			const mid = longest[Math.floor(longest.length / 2)];
			return mid ? [mid[0], mid[1]] : null;
		}
		default:
			return null;
	}
}

/**
 * Polygons and lines, plain (neutral) or filled by value from a scale (choropleth), with a
 * thin outline and a thicker highlight outline on selected features.
 */
export function shapesPlugin<P extends MapFeatureProperties>(options: ShapesOptions<P>): MapPlugin {
	const { id: pluginId, source, layerLabel, mode } = options;
	const selectable = options.selectable ?? false;
	const fillOpacity = options.fillOpacity ?? DEFAULT_FILL_OPACITY;
	const choropleth = mode === "choropleth";

	const scales = createScaleResolver(pluginId, layerLabel, source);
	/** Plain mode ignores the source's scale. */
	const currentScale = (): Resolved | null => (choropleth ? scales.current() : NO_SCALE);
	const legend = () => (choropleth ? scales.legend() : null);

	function features(): FeatureListItem[] {
		const collection = source.features;
		if (!collection) return [];
		const resolved = currentScale();
		const scale = resolved === null || resolved === "unavailable" ? null : resolved;
		const items: FeatureListItem[] = [];
		for (const feature of collection.features) {
			const props = feature.properties;
			if (!props || !feature.geometry) continue;
			const ref = decodeRef(props.refKey);
			const lngLat = labelPoint(feature.geometry);
			if (!ref || !lngLat) continue;
			items.push({
				refKey: props.refKey,
				ref,
				name: props.name,
				value: props.value,
				level: scale ? levelFor(props.value, scale) : NO_LEVEL,
				units: scale?.units ?? "",
				lngLat,
				selectable: selectable && selectionId(ref) !== null
			});
		}
		return items;
	}

	const toHit = (props: Record<string, unknown>) => hitFromProps(pluginId, props);

	function setup(ctx: PluginContext): () => void {
		let dead = false;
		const { gl } = ctx;
		const container = gl.getCanvas().closest?.("[data-mapsdk-map]") ?? null;
		const theme: ThemeColors = themeColors(container);

		let sourceId: string | null = null;
		let checkSourceId: string | null = null;
		/** refKey → label point, from the latest data. */
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
		let labels = new Map<string, [number, number]>();
		/** Namespaced ids of the layers currently on the map, in draw order. */
		let layers: string[] = [];
		/** The scale (by `scaleKey`) the layers on the map were built for. */
		let builtKey: string | null = null;
		let interactiveDone = false;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
		let applied = new Set<string>();

		function removeLayers(): void {
			for (const layerId of layers.toReversed()) {
				if (gl.getLayer(layerId)) gl.removeLayer(layerId);
			}
			layers = [];
			builtKey = null;
		}

		function buildLayers(scale: Scale, src: string): void {
			removeLayers();
			const isLine: ExpressionSpecification = ["match", ["geometry-type"], LINE_TYPES, true, false];
			const lineColor: ExpressionSpecification | string = choropleth
				? ([
						"case",
						isLine,
						colorExpression(scale, "value", theme.neutral),
						theme.foreground
					] as ExpressionSpecification)
				: theme.foreground;
			const fill = ctx.addLayer("fill", {
				type: "fill",
				source: src,
				paint: {
					"fill-color": choropleth ? colorExpression(scale, "value", theme.neutral) : theme.neutral,
					"fill-opacity": choropleth ? opacityExpression(scale, "value", fillOpacity) : fillOpacity
				}
			});
			const outline = ctx.addLayer("outline", {
				type: "line",
				source: src,
				paint: {
					"line-color": lineColor,
					"line-width": ["case", isLine, LINE_WIDTH, OUTLINE_WIDTH] as ExpressionSpecification
				}
			});
			const selectedLayer = ctx.addLayer("selected", {
				type: "line",
				source: src,
				paint: {
					"line-color": theme.highlight,
					"line-width": SELECTED_WIDTH,
					"line-opacity": SELECTED_OPACITY
				}
			});
			const check = ctx.addLayer("check", {
				type: "symbol",
				source: checkSourceId!,
				layout: {
					"icon-image": ctx.id("selected"),
					"icon-size": 1 / IMAGE_RATIO,
					"icon-allow-overlap": true,
					"icon-ignore-placement": true
				}
			});
			layers = [fill, outline, selectedLayer, check];
			// Layer ids repeat across rebuilds; register them once.
			if (!interactiveDone) {
				interactiveDone = true;
				ctx.interactive([fill, outline], toHit);
			}
			builtKey = scaleKey(scale);
		}

		/** One check-mark point per selected feature present in the data. */
		function updateCheck(keys: ReadonlySet<string>): void {
			if (!checkSourceId) return;
			const out: Feature[] = [];
			for (const key of keys) {
				const at = labels.get(key);
				if (at)
					out.push({
						type: "Feature",
						geometry: { type: "Point", coordinates: at },
						properties: {}
					});
			}
			(gl.getSource(checkSourceId) as { setData(d: FeatureCollection): void }).setData({
				type: "FeatureCollection",
				features: out
			});
		}

		function applySelection(keys: ReadonlySet<string>): void {
			if (!sourceId) return;
			updateCheck(keys);
			for (const key of applied) {
				if (!keys.has(key)) gl.removeFeatureState({ source: sourceId, id: key }, "selected");
			}
			for (const key of keys) {
				if (!applied.has(key))
					gl.setFeatureState({ source: sourceId, id: key }, { selected: true });
			}
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
			applied = new Set(keys);
		}

		function render(reactive: FeatureCollection<Geometry, P> | null, scale: Resolved | null): void {
			// Plain objects: MapLibre structured-clones the data to its worker, which a proxy fails.
			const data = ($state.snapshot(reactive) ?? {
				type: "FeatureCollection",
				features: [] as Feature[]
			}) as FeatureCollection;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
			labels = new Map();
			for (const feature of data.features) {
				const props = feature.properties as P | null;
				const at = props && feature.geometry ? labelPoint(feature.geometry) : null;
				if (props && at) labels.set(props.refKey, at);
			}
			if (sourceId) {
				(gl.getSource(sourceId) as { setData(d: FeatureCollection): void }).setData(data);
			} else {
				sourceId = ctx.addSource("shapes", { type: "geojson", data, promoteId: "refKey" });
				checkSourceId = ctx.addSource("check", { type: "geojson", data: EMPTY });
			}
			if (scale === null || scale === "unavailable") {
				removeLayers();
			} else if (builtKey !== scaleKey(scale)) {
				buildLayers(scale, sourceId);
			}
			applySelection(untrack(() => ctx.selectedKeys));
		}

		if (typeof Image !== "undefined") {
			const total = CHECK_SIZE + 2 * SELECTED_OVERLAY_PADDING;
			const image = new Image(total * IMAGE_RATIO, total * IMAGE_RATIO);
			image.onload = () => {
				if (!dead) ctx.addImage("selected", image);
			};
			image.src = asDataURI(
				selectedOverlay(theme.highlight, theme.highlightForeground, CHECK_SIZE)
			);
		}

		if (choropleth) scales.track(ctx, () => dead);

		ctx.effect(() => {
			const collection = source.features;
			const scale = currentScale();
			untrack(() => render(collection, scale));
		});

		ctx.effect(() => {
			const keys = ctx.selectedKeys;
			untrack(() => applySelection(keys));
		});

		return () => {
			dead = true;
		};
	}

	const plugin: MapPlugin = { id: pluginId, setup, legend, selectable };
	if (options.listed ?? true) plugin.features = features;
	return plugin;
}
