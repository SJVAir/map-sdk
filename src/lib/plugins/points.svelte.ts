import type {
	ExpressionSpecification,
	FilterSpecification,
	GeoJSONSourceSpecification
} from "@maptiler/sdk";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GlMapLike } from "../core/gl.js";
import { untrack, type Snippet } from "svelte";
import type {
	FeatureHit,
	FeatureListItem,
	LegendData,
	LayerSpecWithoutId,
	MapPlugin,
	PluginContext,
	Providers
} from "../core/plugin.js";
import { decodeRef, selectionId } from "../data/refs.js";
import { levelFor, NO_LEVEL } from "../data/scale.js";
import type { Scale } from "../data/scale-types.js";
import type { DataSource, MapFeatureProperties } from "../data/types.js";
import { asDataURI, SELECTED_OVERLAY_PADDING, selectedOverlay } from "./icons.js";
import {
	clusterHit,
	clusterLeaves,
	defaultClusterLayers,
	parseClusterHit,
	zoomIntoCluster,
	type ClusterInfo,
	type ClusterLayerArgs,
	type ClusterLayers
} from "./points-clusters.js";
import { hitFromProps, SELECTED_OPACITY } from "./shared.js";
import {
	createScaleResolver,
	datasetOf,
	scaleKey,
	type Resolved
} from "./scale-resolution.svelte.js";
import {
	colorExpression,
	levelKeyExpression,
	opacityExpression,
	themeColors,
	type ThemeColors
} from "./style.js";

export type { ClusterInfo, ClusterLayerArgs } from "./points-clusters.js";

/** What tooltip content gets: the map's providers and the plugin's resolved scale. */
export interface PointsTooltipEnv extends Providers {
	/** Null while it resolves or when unavailable. */
	scale: Scale | null;
	/** Decimal places for values, as the list items carry it. */
	precision: number;
}

export interface PointsOptions<P extends MapFeatureProperties> {
	id: string;
	source: DataSource<P>;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	selectable?: boolean;
	/**
	 * How a selected feature shows. "ring" (default): a highlight ring and check mark over it.
	 * "enlarge": the icon draws at 1.3x with no ring (icons only; circles are unchanged).
	 */
	selectedStyle?: "ring" | "enlarge";
	icon?: {
		category(props: P): string;
		/**
		 * An SVG `size` pixels square, filled with `color`; `theme` for outlines. `levelIndex` is the
		 * level's position in the scale, or -1 for the neutral image.
		 */
		draw(category: string, color: string, theme: ThemeColors, levelIndex?: number): string;
		size: number;
		/** Draws in `mutedColor` whatever the value (e.g. an inactive monitor). */
		muted?(props: P): boolean;
		/** The color of muted images. Default: the theme's `--muted-foreground`. */
		mutedColor?: string;
	};
	/** Used when there is no `icon`. */
	circle?: { radius: number };
	/**
	 * One clustered source per group. Cluster bubbles hide what is beneath them from clicks and
	 * hovers; clicking one zooms in to expand it.
	 */
	cluster?: {
		radius: number;
		maxZoom: number;
		groupBy?(props: P): string;
		/** MapLibre `clusterProperties`: aggregates the layers and tooltip can read. */
		properties?: GeoJSONSourceSpecification["clusterProperties"];
		/** Replaces the neutral count bubbles. Local ids get the group appended. */
		layers?(args: ClusterLayerArgs): ClusterLayers;
		/** Tooltip content for a hovered cluster. Without it, hovering a bubble shows nothing. */
		tooltip?(cluster: ClusterInfo<P>, env: PointsTooltipEnv): Snippet | undefined;
	};
	/** Higher draws on top (and, clustered, a group with a higher key draws above the others). */
	sortKey?(props: P): number;
	/**
	 * Limits every layer the plugin draws (points, clusters, selection) to a zoom range: visible
	 * from `min` (inclusive) up to `max` (exclusive) of the camera zoom, switching live while
	 * zooming (layer visibility, not layer zoom ranges, so ranges that meet leave no gap on a
	 * globe). Default: all zooms.
	 */
	zoomRange?: { min?: number; max?: number };
	/** How the legend shows a range scale: a gradient (default) or labeled blocks. */
	legendDisplay?: "gradient" | "blocks";
	/**
	 * What titles the legend section: `layerLabel` (default) or, for a source with a `ScaleRef`,
	 * the entry type's label from the metadata provider (e.g. "PM2.5"), with `layerLabel` until
	 * it loads.
	 */
	legendTitle?: "layer" | "entry-type";
	/**
	 * A short text for a feature with no level (e.g. "Level 2 charger"), shown in the feature list,
	 * its accessible name, and the generic tooltip where "No level" would be. Ignored for a
	 * feature with a level.
	 */
	detail?(props: P): string | undefined;
	/**
	 * Cut values off at the display precision instead of rounding them, in the list, its
	 * accessible names, and the generic tooltip (`FeatureListItem.truncate`). Default false.
	 */
	truncateValues?: boolean;
	/** Whether `features()` lists this plugin's features. Default true. */
	listed?: boolean;
	/**
	 * A focus point at one of its features gives way to it: the plugin gets `drawnAt`, so the focus
	 * area leaves out its own row while the feature's marker is drawn there. Default false.
	 */
	marksPlaces?: boolean;
	/** Tooltip content for a feature, below its name; `props` are its source properties. */
	tooltip?(item: FeatureListItem, props: P, env: PointsTooltipEnv): Snippet | undefined;
	/**
	 * The `tooltip` content shows the feature's name itself, so no name header is drawn above
	 * it.
	 */
	tooltipShowsName?: boolean;
}

/** Properties the plugin adds to each feature it hands MapLibre. */
const CATEGORY_PROP = "mapsdk:category";
const SORT_KEY_PROP = "mapsdk:sortKey";
const MUTED_PROP = "mapsdk:muted";
/** The icon image suffix for muted features; no scale level key starts with "mapsdk:". */
const MUTED_IMAGE = "mapsdk:muted";

/** Marker images are drawn at this multiple of their size and scaled down, for sharp HiDPI. */
const IMAGE_RATIO = 2;
/** The icon scale of a selected feature with `selectedStyle: "enlarge"`. */
const ENLARGE = 1.3;
const DEFAULT_RADIUS = 6;
const UNCLUSTERED: FilterSpecification = ["!", ["has", "point_count"]];
/**
 * Points with value-based color: anything with coordinates. Draws circles, or icons by
 * category (one image per category and level color), optionally clustered per group, with a
 * highlight ring and check mark over selected features.
 */
export function pointsPlugin<P extends MapFeatureProperties>(options: PointsOptions<P>): MapPlugin {
	const { id: pluginId, source, layerLabel, icon, cluster } = options;
	const selectable = options.selectable ?? false;
	const enlarge = options.selectedStyle === "enlarge";
	const groupOf = cluster?.groupBy ?? (() => "");

	const scales = createScaleResolver(
		pluginId,
		layerLabel,
		source,
		options.legendTitle === "entry-type"
	);
	const currentScale = scales.current;
	const legend = (): LegendData | null => {
		const data = scales.legend();
		return data && "scale" in data && options.legendDisplay
			? { ...data, display: options.legendDisplay }
			: data;
	};

	/** The providers of the running setup, for tooltips; null while not set up. */
	let providers: Providers | null = null;
	/** The running setup's map and cluster sources, for cluster tooltips; null while not set up. */
	let live: { gl: GlMapLike; sourceOf(group: string): string | undefined; dead(): boolean } | null =
		null;
	/** Bumped on every data render: cluster ids from older data name nothing. Reactive. */
	let dataGeneration = $state(0);
	/** Bumped when an answer `drawnAt` gave changes (checked at `idle`). Reactive. */
	let settled = $state(0);
	/** The running setup's map and point layers, for `drawnAt`; null while not set up. */
	let drawn: { gl: GlMapLike; layers(): string[] } | null = null;
	/**
	 * Each point `drawnAt` was asked about and its answer, kept until the map settles again, so a
	 * refresh or zoom that isn't drawn yet doesn't flip it back and forth. Not reactive (`settled`
	 * is).
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, see `settled`
	const answers = new Map<string, { at: [number, number]; drawn: boolean }>();

	/** Whether a feature at exactly `at` is rendered as its own marker right now. */
	function rendersAt(running: { gl: GlMapLike; layers(): string[] }, at: [number, number]) {
		// Source coordinates, exact: rendered tile geometry is quantized.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, not reactive
		const keys = new Set<string>();
		for (const feature of source.features?.features ?? []) {
			const g = feature.geometry;
			if (g?.type !== "Point" || !feature.properties) continue;
			if (g.coordinates[0] === at[0] && g.coordinates[1] === at[1]) {
				keys.add(feature.properties.refKey);
			}
		}
		const layers = running.layers();
		if (keys.size === 0 || layers.length === 0) return false;
		const { x, y } = running.gl.project(at);
		return running.gl
			.queryRenderedFeatures([x, y], { layers })
			.some((f) => keys.has(f.properties.refKey as string));
	}

	/** Whether a feature at exactly `lngLat` is drawn as its own marker (see `marksPlaces`). */
	function drawnAt(lngLat: [number, number]): boolean {
		void settled;
		const running = drawn;
		if (!running) return false;
		const key = `${lngLat[0]},${lngLat[1]}`;
		let known = answers.get(key);
		if (!known) {
			known = { at: [lngLat[0], lngLat[1]], drawn: untrack(() => rendersAt(running, lngLat)) };
			answers.set(key, known);
		}
		return known.drawn;
	}

	function tooltipEnv(): PointsTooltipEnv | null {
		if (!providers) return null;
		const resolved = currentScale();
		const scale = resolved === null || resolved === "unavailable" ? null : resolved;
		return { ...providers, scale, precision: scales.precision() };
	}

	function featureTooltip(item: FeatureListItem): Snippet | undefined {
		const env = tooltipEnv();
		const props = source.features?.features.find(
			(f) => f.properties?.refKey === item.refKey
		)?.properties;
		if (!env || !props) return undefined;
		return options.tooltip?.(item, props, env);
	}

	/** A hovered bubble's content, from the hit alone; none once its data was replaced. */
	function clusterTooltip(hit: FeatureHit): Snippet | undefined {
		const named = parseClusterHit(hit);
		if (!named || named.generation !== dataGeneration) return undefined;
		const env = tooltipEnv();
		const running = live;
		const sourceId = running?.sourceOf(named.group);
		if (!env || !running || !sourceId || !cluster?.tooltip) return undefined;
		const properties = hit.properties ?? {};
		const pointCount = typeof properties.point_count === "number" ? properties.point_count : 0;
		const info: ClusterInfo<P> = {
			group: named.group,
			pointCount,
			properties,
			leaves: () =>
				clusterLeaves<P>(running.gl, sourceId, named.clusterId, pointCount, running.dead)
		};
		return cluster.tooltip(info, env);
	}

	function features(): FeatureListItem[] {
		const collection = source.features;
		if (!collection) return [];
		const resolved = currentScale();
		const scale = resolved === null || resolved === "unavailable" ? null : resolved;
		const precision = scales.precision();
		const items: FeatureListItem[] = [];
		for (const feature of collection.features) {
			const props = feature.properties;
			const geometry = feature.geometry;
			if (!props || geometry?.type !== "Point") continue;
			const ref = decodeRef(props.refKey);
			if (!ref) continue;
			const [lng, lat] = geometry.coordinates;
			const detail = options.detail?.(props)?.trim();
			items.push({
				refKey: props.refKey,
				ref,
				name: props.name,
				value: props.value,
				level: scale ? levelFor(props.value, scale) : NO_LEVEL,
				units: scale?.units ?? "",
				precision,
				lngLat: [lng, lat],
				selectable: selectable && selectionId(ref) !== null,
				...(detail ? { detail } : {}),
				...(options.truncateValues ? { truncate: true } : {})
			});
		}
		return items;
	}

	function setup(ctx: PluginContext): () => void {
		let dead = false;
		const { gl } = ctx;
		providers = { metadata: ctx.metadata, messages: ctx.messages, format: ctx.format };
		live = { gl, sourceOf: (group) => sources.get(group), dead: () => dead };
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
		/** The subset of `layers` that draw the points themselves. */
		let pointLayerIds: string[] = [];
		const interactiveLayers = new Set<string>();
		const clusterLayerIds = new Set<string>();
		const images = new Set<string>();
		/** Group → highest sort key seen, for drawing groups in order. */
		const groupRank = new Map<string, number>();
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

		function ensureIcons(scale: Scale, categories: Iterable<string>): void {
			if (!icon) return;
			for (const category of categories) {
				// Every level of the scale, plus the neutral image for values no level covers.
				for (const [index, level] of [...scale.levels, null].entries()) {
					const local = `${iconPrefix()}${category}:${level?.key ?? ""}`;
					if (images.has(local)) continue;
					const color = level?.color || theme.neutral;
					loadImage(local, icon.draw(category, color, theme, level ? index : -1), icon.size);
				}
				const muted = `${iconPrefix()}${category}:${MUTED_IMAGE}`;
				if (icon.muted && !images.has(muted)) {
					loadImage(
						muted,
						icon.draw(category, icon.mutedColor ?? theme.mutedForeground, theme),
						icon.size
					);
				}
			}
		}

		function iconImage(category: string | ExpressionSpecification, levelKey: unknown) {
			return ["concat", ctx.id(iconPrefix()), category, ":", levelKey] as ExpressionSpecification;
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
				if (icon?.muted) extra[MUTED_PROP] = icon.muted(props);
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
				if (cluster.properties) spec.clusterProperties = cluster.properties;
			}
			return spec;
		}

		// The zoom range shows and hides the layers by the camera zoom, not with layer
		// minzoom/maxzoom: on a globe MapLibre uses the next zoom's tiles a little before the camera
		// gets there and leaves a layer out of tiles at or above its maxzoom, so two plugins whose
		// ranges meet (fire groups below 10, hotspots from 10) would leave a gap where neither drew.
		const { min, max } = options.zoomRange ?? {};
		const ranged = min !== undefined || max !== undefined;
		const inRange = () => {
			const zoom = gl.getZoom();
			return (min === undefined || zoom >= min) && (max === undefined || zoom < max);
		};
		let shown = ranged ? inRange() : true;

		/** The spec, hidden while the camera is outside the plugin's zoom range. */
		function zoomed(spec: LayerSpecWithoutId): LayerSpecWithoutId {
			if (!ranged) return spec;
			const layout = (spec as { layout?: Record<string, unknown> }).layout;
			return {
				...spec,
				layout: { ...layout, visibility: shown ? "visible" : "none" }
			} as LayerSpecWithoutId;
		}

		const onZoom = () => {
			if (dead || inRange() === shown) return;
			shown = !shown;
			for (const layerId of layers) {
				if (gl.getLayer(layerId)) {
					gl.setLayoutProperty(layerId, "visibility", shown ? "visible" : "none");
				}
			}
		};
		if (ranged) gl.on("zoom", onZoom);

		function removeLayers(): void {
			for (const layerId of layers.toReversed()) {
				if (gl.getLayer(layerId)) gl.removeLayer(layerId);
			}
			layers = [];
			pointLayerIds = [];
			built = null;
		}

		function pointLayer(scale: Scale, sourceId: string): LayerSpecWithoutId {
			const filter = cluster ? { filter: UNCLUSTERED } : {};
			const sortKey = options.sortKey ? ["get", SORT_KEY_PROP] : undefined;
			if (icon) {
				const levelKey = levelKeyExpression(scale, "value");
				return {
					type: "symbol",
					source: sourceId,
					...filter,
					layout: {
						"icon-image": iconImage(
							["get", CATEGORY_PROP],
							icon.muted
								? ["case", ["==", ["get", MUTED_PROP], true], MUTED_IMAGE, levelKey]
								: levelKey
						),
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

		/** A group's cluster layers; they block what is beneath them and zoom in on click. */
		function clusterLayers(scale: Scale, group: string, sourceId: string): void {
			const args: ClusterLayerArgs = {
				group,
				sourceId,
				scale,
				theme,
				iconSizeScale: 1 / IMAGE_RATIO,
				iconImage(category, levelKey) {
					ensureIcons(scale, [category]);
					return iconImage(category, levelKey);
				}
			};
			const added: string[] = [];
			for (const { local, spec } of (cluster?.layers ?? defaultClusterLayers)(args)) {
				added.push(ctx.addLayer(layerLocal(local, group), zoomed(spec)));
			}
			layers.push(...added);
			const fresh = added.filter((layerId) => !clusterLayerIds.has(layerId));
			if (fresh.length === 0) return;
			for (const layerId of fresh) clusterLayerIds.add(layerId);
			const isDead = () => dead;
			ctx.blocking(
				fresh,
				// A hover hit only when there is content to show for it.
				cluster?.tooltip
					? (props) =>
							clusterHit(
								pluginId,
								untrack(() => dataGeneration),
								group,
								props
							)
					: undefined,
				(feature) => zoomIntoCluster(gl, sourceId, feature, isDead, pluginId)
			);
		}

		/** Adds every layer for `groups` in draw order: clusters, then points, then selection. */
		function buildLayers(scale: Scale, groups: string[]): void {
			removeLayers();
			if (cluster) for (const group of groups) clusterLayers(scale, group, sources.get(group)!);
			const pointIds: string[] = [];
			for (const group of groups) {
				const layerId = ctx.addLayer(
					layerLocal("points", group),
					zoomed(pointLayer(scale, sources.get(group)!))
				);
				layers.push(layerId);
				pointIds.push(layerId);
			}
			pointLayerIds = pointIds;
			if (!enlarge) {
				for (const group of groups) {
					layers.push(
						ctx.addLayer(layerLocal("selected", group), zoomed(overlayLayer(sources.get(group)!)))
					);
				}
			}
			const fresh = pointIds.filter((layerId) => !interactiveLayers.has(layerId));
			if (fresh.length) {
				for (const layerId of fresh) interactiveLayers.add(layerId);
				ctx.interactive(fresh, toHit);
			}
			built = { scaleKey: scaleKey(scale), groups };
		}

		const toHit = (props: Record<string, unknown>) => hitFromProps(pluginId, props);

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
			if (enlarge && icon) enlargeSelected(keys);
		}

		/**
		 * Sizes the selected keys' icons up. `icon-size` is a layout property: no feature-state.
		 */
		function enlargeSelected(keys: ReadonlySet<string>): void {
			const size =
				keys.size === 0
					? 1 / IMAGE_RATIO
					: [
							"case",
							["in", ["get", "refKey"], ["literal", [...keys]]],
							ENLARGE / IMAGE_RATIO,
							1 / IMAGE_RATIO
						];
			for (const layerId of pointLayerIds) gl.setLayoutProperty(layerId, "icon-size", size);
		}

		function render(reactive: FeatureCollection<Geometry, P> | null, scale: Resolved | null): void {
			// Plain objects: MapLibre structured-clones the data to its worker, which a proxy fails.
			const collection = $state.snapshot(reactive) as FeatureCollection<Geometry, P> | null;
			// Sources: one per group present, kept (and emptied) when a group disappears.
			/* eslint-disable svelte/prefer-svelte-reactivity -- locals for one render */
			const present = new Set<string>(grouped ? [] : [""]);
			const categories = new Set<string>();
			const byKey = new Map<string, string>();
			const rank = new Map<string, number>();
			/* eslint-enable svelte/prefer-svelte-reactivity */
			for (const feature of collection?.features ?? []) {
				const props = feature.properties;
				if (!props) continue;
				const group = groupOf(props);
				present.add(group);
				byKey.set(props.refKey, group);
				if (icon) categories.add(icon.category(props));
				if (options.sortKey) {
					rank.set(group, Math.max(rank.get(group) ?? -Infinity, options.sortKey(props)));
				}
			}
			for (const [group, max] of rank) groupRank.set(group, max);
			groupByKey = byKey;
			dataGeneration++;
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
				// Lowest rank first, so the group with the highest sort key draws on top.
				const groups = [...sources.keys()].sort(
					(a, b) => (groupRank.get(a) ?? -Infinity) - (groupRank.get(b) ?? -Infinity)
				);
				if (!built || built.scaleKey !== key || built.groups.join("\n") !== groups.join("\n")) {
					buildLayers(scale, groups);
				}
			}
			applySelection(untrack(() => ctx.selectedKeys));
		}

		if (!enlarge) {
			loadImage(
				"selected",
				selectedOverlay(theme.highlight, theme.highlightForeground, markerSize),
				markerSize + 2 * SELECTED_OVERLAY_PADDING
			);
		}

		scales.track(ctx, () => dead);

		const onIdle = () => {
			const running = drawn;
			if (dead || !running) return;
			let changed = false;
			for (const known of answers.values()) {
				const now = untrack(() => rendersAt(running, known.at));
				if (now !== known.drawn) {
					known.drawn = now;
					changed = true;
				}
			}
			if (changed) settled++;
		};
		if (options.marksPlaces) {
			answers.clear();
			drawn = { gl, layers: () => pointLayerIds };
			gl.on("idle", onIdle);
		}

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
			if (ranged) gl.off("zoom", onZoom);
			if (options.marksPlaces) gl.off("idle", onIdle);
			providers = null;
			live = null;
			drawn = null;
			answers.clear();
			settled++;
		};
	}

	const plugin: MapPlugin = {
		id: pluginId,
		label: layerLabel,
		get dataset() {
			return datasetOf(source);
		},
		setup,
		legend,
		selectable
	};
	if (options.listed ?? true) plugin.features = features;
	if (options.marksPlaces) plugin.drawnAt = drawnAt;
	if (options.tooltip) plugin.tooltip = featureTooltip;
	if (options.tooltipShowsName) plugin.tooltipShowsName = true;
	if (cluster?.tooltip) plugin.hoverTooltip = clusterTooltip;
	return plugin;
}
