import type {
	ExpressionSpecification,
	FilterSpecification,
	GeoJSONSourceSpecification
} from "@maptiler/sdk";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { untrack } from "svelte";
import type {
	FeatureHit,
	FeatureListItem,
	LayerSpecWithoutId,
	MapPlugin,
	PluginContext
} from "../core/plugin.js";
import { decodeRef, selectionId } from "../data/refs.js";
import { levelFor, NO_LEVEL } from "../data/scale.js";
import type { Scale } from "../data/scale-types.js";
import type { DataSource, MapFeatureProperties } from "../data/types.js";
import { asDataURI, SELECTED_OVERLAY_PADDING, selectedOverlay } from "./icons.js";
import { createScaleResolver, scaleKey, type Resolved } from "./scale-resolution.svelte.js";
import {
	colorExpression,
	levelKeyExpression,
	opacityExpression,
	themeColors,
	type ThemeColors
} from "./style.js";

export interface PointsOptions<P extends MapFeatureProperties> {
	id: string;
	source: DataSource<P>;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	selectable?: boolean;
	icon?: {
		category(props: P): string;
		/** An SVG `size` pixels square, filled with `color`. */
		draw(category: string, color: string): string;
		size: number;
	};
	/** Used when there is no `icon`. */
	circle?: { radius: number };
	/** One clustered source per group. */
	cluster?: { radius: number; maxZoom: number; groupBy?(props: P): string };
	/** Higher draws on top. */
	sortKey?(props: P): number;
	/** Whether `features()` lists this plugin's features. Default true. */
	listed?: boolean;
}

/** Properties the plugin adds to each feature it hands MapLibre. */
const CATEGORY_PROP = "mapsdk:category";
const SORT_KEY_PROP = "mapsdk:sortKey";

/** Marker images are drawn at this multiple of their size and scaled down, for sharp HiDPI. */
const IMAGE_RATIO = 2;
const DEFAULT_RADIUS = 6;
const UNCLUSTERED: FilterSpecification = ["!", ["has", "point_count"]];
const CLUSTERED: FilterSpecification = ["has", "point_count"];
const SELECTED_OPACITY: ExpressionSpecification = [
	"case",
	["boolean", ["feature-state", "selected"], false],
	1,
	0
];
/**
 * Points with value-based color: anything with coordinates. Draws circles, or icons by
 * category (one image per category and level color), optionally clustered per group, with a
 * highlight ring and check mark over selected features.
 */
export function pointsPlugin<P extends MapFeatureProperties>(options: PointsOptions<P>): MapPlugin {
	const { id: pluginId, source, layerLabel, icon, cluster } = options;
	const selectable = options.selectable ?? false;
	const groupOf = cluster?.groupBy ?? (() => "");

	const scales = createScaleResolver(pluginId, layerLabel, source);
	const currentScale = scales.current;
	const legend = scales.legend;

	function features(): FeatureListItem[] {
		const collection = source.features;
		if (!collection) return [];
		const resolved = currentScale();
		const scale = resolved === null || resolved === "unavailable" ? null : resolved;
		const items: FeatureListItem[] = [];
		for (const feature of collection.features) {
			const props = feature.properties;
			const geometry = feature.geometry;
			if (!props || geometry?.type !== "Point") continue;
			const ref = decodeRef(props.refKey);
			if (!ref) continue;
			const [lng, lat] = geometry.coordinates;
			items.push({
				refKey: props.refKey,
				ref,
				name: props.name,
				value: props.value,
				level: scale ? levelFor(props.value, scale) : NO_LEVEL,
				units: scale?.units ?? "",
				lngLat: [lng, lat],
				selectable: selectable && selectionId(ref) !== null
			});
		}
		return items;
	}

	function setup(ctx: PluginContext): () => void {
		let dead = false;
		const { gl } = ctx;
		const container = gl.getCanvas().closest?.("[data-mapsdk-map]") ?? null;
		const theme: ThemeColors = themeColors(container);
		const grouped = cluster?.groupBy !== undefined;
		const sourceLocal = (group: string) => (grouped ? `points:${group}` : "points");
		const layerLocal = (base: string, group: string) => (grouped ? `${base}:${group}` : base);

		// Bookkeeping for this setup only; nothing reads these reactively.
		/* eslint-disable svelte/prefer-svelte-reactivity */
		/** Group → namespaced source id. Sources stay until teardown (emptied when unused). */
		const sources = new Map<string, string>();
		/** Namespaced ids of the layers currently on the map, in draw order. */
		let layers: string[] = [];
		const interactiveLayers = new Set<string>();
		const images = new Set<string>();
		/** Source id → refKeys whose `selected` state is set there. */
		const applied = new Map<string, Set<string>>();
		/** refKey → group, from the latest data. */
		let groupByKey = new Map<string, string>();
		/* eslint-enable svelte/prefer-svelte-reactivity */
		/** What the layers on the map were built for (the scale by `scaleKey`). */
		let built: { scaleKey: string; groups: string[] } | null = null;
		/** Bumped per distinct scale, so a new scale's icon images never collide with the old. */
		let scaleGeneration = -1;
		let generationKey: string | null = null;

		const markerSize = icon ? icon.size : (options.circle?.radius ?? DEFAULT_RADIUS) * 2;

		function loadImage(local: string, svg: string, size: number): void {
			if (images.has(local) || typeof Image === "undefined") return;
			images.add(local);
			const image = new Image(size * IMAGE_RATIO, size * IMAGE_RATIO);
			image.onload = () => {
				if (!dead) ctx.addImage(local, image);
			};
			image.src = asDataURI(svg);
		}

		function iconPrefix(): string {
			return `icon:${scaleGeneration}:`;
		}

		function ensureIcons(scale: Scale, categories: Set<string>): void {
			if (!icon) return;
			for (const category of categories) {
				// Every level of the scale, plus the neutral image for values no level covers.
				for (const level of [...scale.levels, null]) {
					const local = `${iconPrefix()}${category}:${level?.key ?? ""}`;
					if (images.has(local)) continue;
					const color = level?.color || theme.neutral;
					loadImage(local, icon.draw(category, color), icon.size);
				}
			}
		}

		/** The plain feature collection for one group, with the properties layers read. */
		function groupData(
			collection: FeatureCollection<Geometry, P> | null,
			group: string
		): FeatureCollection {
			const out: Feature[] = [];
			for (const feature of collection?.features ?? []) {
				const props = feature.properties;
				if (!props || groupOf(props) !== group) continue;
				const extra: Record<string, unknown> = {};
				if (icon) extra[CATEGORY_PROP] = icon.category(props);
				if (options.sortKey) extra[SORT_KEY_PROP] = options.sortKey(props);
				out.push({
					type: "Feature",
					geometry: feature.geometry,
					properties: { ...props, ...extra }
				});
			}
			return { type: "FeatureCollection", features: out };
		}

		function sourceSpec(data: FeatureCollection): GeoJSONSourceSpecification {
			const spec: GeoJSONSourceSpecification = { type: "geojson", data, promoteId: "refKey" };
			if (cluster) {
				spec.cluster = true;
				spec.clusterRadius = cluster.radius;
				spec.clusterMaxZoom = cluster.maxZoom;
			}
			return spec;
		}

		function removeLayers(): void {
			for (const layerId of layers.toReversed()) {
				if (gl.getLayer(layerId)) gl.removeLayer(layerId);
			}
			layers = [];
			built = null;
		}

		function pointLayer(scale: Scale, sourceId: string): LayerSpecWithoutId {
			const filter = cluster ? { filter: UNCLUSTERED } : {};
			const sortKey = options.sortKey ? ["get", SORT_KEY_PROP] : undefined;
			if (icon) {
				return {
					type: "symbol",
					source: sourceId,
					...filter,
					layout: {
						"icon-image": [
							"concat",
							ctx.id(iconPrefix()),
							["get", CATEGORY_PROP],
							":",
							levelKeyExpression(scale, "value")
						] as ExpressionSpecification,
						"icon-size": 1 / IMAGE_RATIO,
						"icon-allow-overlap": true,
						"icon-ignore-placement": true,
						...(sortKey ? { "symbol-sort-key": sortKey as ExpressionSpecification } : {})
					}
				};
			}
			return {
				type: "circle",
				source: sourceId,
				...filter,
				layout: sortKey ? { "circle-sort-key": sortKey as ExpressionSpecification } : {},
				paint: {
					"circle-radius": options.circle?.radius ?? DEFAULT_RADIUS,
					"circle-color": colorExpression(scale, "value", theme.neutral),
					"circle-opacity": opacityExpression(scale, "value", 1),
					"circle-stroke-color": theme.foreground,
					"circle-stroke-width": 1
				}
			};
		}

		function overlayLayer(sourceId: string): LayerSpecWithoutId {
			const sortKey = options.sortKey ? ["get", SORT_KEY_PROP] : undefined;
			return {
				type: "symbol",
				source: sourceId,
				...(cluster ? { filter: UNCLUSTERED } : {}),
				layout: {
					"icon-image": ctx.id("selected"),
					"icon-size": 1 / IMAGE_RATIO,
					"icon-allow-overlap": true,
					"icon-ignore-placement": true,
					...(sortKey ? { "symbol-sort-key": sortKey as ExpressionSpecification } : {})
				},
				paint: { "icon-opacity": SELECTED_OPACITY }
			};
		}

		/** Cluster bubbles: a neutral circle with the count. Presets restyle them. */
		function clusterLayers(group: string, sourceId: string): void {
			layers.push(
				ctx.addLayer(layerLocal("clusters", group), {
					type: "circle",
					source: sourceId,
					filter: CLUSTERED,
					paint: {
						"circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 25, 20],
						"circle-color": theme.neutral,
						"circle-stroke-color": theme.foreground,
						"circle-stroke-width": 1
					}
				}),
				ctx.addLayer(layerLocal("cluster-count", group), {
					type: "symbol",
					source: sourceId,
					filter: CLUSTERED,
					layout: {
						"text-field": ["get", "point_count_abbreviated"],
						"text-size": 12,
						"text-allow-overlap": true
					},
					paint: { "text-color": theme.foreground }
				})
			);
		}

		/** Adds every layer for `groups` in draw order: clusters, then points, then selection. */
		function buildLayers(scale: Scale, groups: string[]): void {
			removeLayers();
			if (cluster) for (const group of groups) clusterLayers(group, sources.get(group)!);
			const pointIds: string[] = [];
			for (const group of groups) {
				const layerId = ctx.addLayer(
					layerLocal("points", group),
					pointLayer(scale, sources.get(group)!)
				);
				layers.push(layerId);
				pointIds.push(layerId);
			}
			for (const group of groups) {
				layers.push(ctx.addLayer(layerLocal("selected", group), overlayLayer(sources.get(group)!)));
			}
			const fresh = pointIds.filter((layerId) => !interactiveLayers.has(layerId));
			if (fresh.length) {
				for (const layerId of fresh) interactiveLayers.add(layerId);
				ctx.interactive(fresh, toHit);
			}
			built = { scaleKey: scaleKey(scale), groups };
		}

		function toHit(props: Record<string, unknown>): FeatureHit | null {
			const refKey = props.refKey;
			if (typeof refKey !== "string") return null;
			const ref = decodeRef(refKey);
			if (!ref) return null;
			return { pluginId, ref, refKey, name: typeof props.name === "string" ? props.name : "" };
		}

		/** Sets `selected` feature-state for `keys` and clears it for everything else. */
		function applySelection(keys: ReadonlySet<string>): void {
			for (const [group, sourceId] of sources) {
				// Ungrouped, a key not in the data is set anyway: it shows when the feature appears.
				/* eslint-disable svelte/prefer-svelte-reactivity -- bookkeeping, not reactive */
				const want = new Set([...keys].filter((key) => !grouped || groupByKey.get(key) === group));
				const had = applied.get(sourceId) ?? new Set<string>();
				/* eslint-enable svelte/prefer-svelte-reactivity */
				for (const key of had) {
					if (!want.has(key)) gl.removeFeatureState({ source: sourceId, id: key }, "selected");
				}
				for (const key of want) {
					if (!had.has(key)) gl.setFeatureState({ source: sourceId, id: key }, { selected: true });
				}
				applied.set(sourceId, want);
			}
		}

		function render(reactive: FeatureCollection<Geometry, P> | null, scale: Resolved | null): void {
			// Plain objects: MapLibre structured-clones the data to its worker, which a proxy fails.
			const collection = $state.snapshot(reactive) as FeatureCollection<Geometry, P> | null;
			// Sources: one per group present, kept (and emptied) when a group disappears.
			/* eslint-disable svelte/prefer-svelte-reactivity -- locals for one render */
			const present = new Set<string>(grouped ? [] : [""]);
			const categories = new Set<string>();
			const byKey = new Map<string, string>();
			/* eslint-enable svelte/prefer-svelte-reactivity */
			for (const feature of collection?.features ?? []) {
				const props = feature.properties;
				if (!props) continue;
				const group = groupOf(props);
				present.add(group);
				byKey.set(props.refKey, group);
				if (icon) categories.add(icon.category(props));
			}
			groupByKey = byKey;
			for (const group of present) {
				const data = groupData(collection, group);
				const existing = sources.get(group);
				if (existing) {
					(gl.getSource(existing) as { setData(d: FeatureCollection): void }).setData(data);
				} else {
					sources.set(group, ctx.addSource(sourceLocal(group), sourceSpec(data)));
				}
			}
			for (const [group, sourceId] of sources) {
				if (present.has(group)) continue;
				(gl.getSource(sourceId) as { setData(d: FeatureCollection): void }).setData(
					groupData(null, group)
				);
			}

			// Layers: only with a usable scale; rebuilt only for a new scale or a new group.
			if (scale === null || scale === "unavailable") {
				removeLayers();
			} else {
				// By value: a host may hand over an equal fresh Scale on every poll.
				const key = scaleKey(scale);
				if (key !== generationKey) {
					generationKey = key;
					scaleGeneration++;
				}
				ensureIcons(scale, categories);
				const groups = [...sources.keys()];
				if (
					!built ||
					built.scaleKey !== key ||
					groups.some((group) => !built!.groups.includes(group))
				) {
					buildLayers(scale, groups);
				}
			}
			applySelection(untrack(() => ctx.selectedKeys));
		}

		loadImage(
			"selected",
			selectedOverlay(theme.highlight, theme.highlightForeground, markerSize),
			markerSize + 2 * SELECTED_OVERLAY_PADDING
		);

		scales.track(ctx, () => dead);

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
