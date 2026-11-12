import type { ExpressionSpecification } from "@maptiler/sdk";
import {
	createRawSnippet,
	mount,
	unmount,
	type Component,
	type ComponentProps,
	type Snippet
} from "svelte";
import type { MapPlugin } from "../core/plugin.js";
import type { MetadataProvider } from "../data/metadata.js";
import type { DataSource, MonitorFeatureProperties } from "../data/types.js";
import { circle, square, triangle } from "../plugins/icons.js";
import { pointsPlugin, type ClusterLayerArgs } from "../plugins/points.svelte.js";
import {
	hasNumericValue,
	levelKeyExpression,
	levelLookup,
	MISSING_VALUE
} from "../plugins/style.js";
import { levelChip } from "../ui/level-chip.js";
import { reactiveProps } from "./reactive-props.svelte.js";
import MonitorClusterTooltip from "./MonitorClusterTooltip.svelte";
import MonitorTooltip from "./MonitorTooltip.svelte";

// Ported from monitor-map 4.3.0 (src/lib/monitors/): shapes, draw order, icon variants, and
// cluster rendering. Shapes, sizes, and order are presentation; colors come from the scale and
// the theme, except the two fixed monitor colors below.

// The user's decision (2026-11-04), an exception to the theme-token rule: inactive monitors are
// this gray and inside monitors have a black outline, on every map and theme, as on sjvair.com.
export const MONITOR_INACTIVE_COLOR = "#969696";
export const MONITOR_INSIDE_OUTLINE = "#000000";

export interface MonitorsPluginOptions {
	/** Default "monitors". */
	id?: string;
	source: DataSource<MonitorFeatureProperties>;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	/** Default true, like the shape presets. */
	selectable?: boolean;
	/** "ring" (default): ring and check mark. "enlarge": the selected icon draws at 1.3x. */
	selectedStyle?: "ring" | "enlarge";
	/** Cluster each monitor type below zoom 9. Default true. */
	clustered?: boolean;
}

export type MonitorShape = "circle" | "square" | "triangle";

/** The marker shape for a monitor type: reference monitors are triangles, sensors circles. */
export function monitorShape(type: string): MonitorShape {
	switch (type) {
		case "airnow":
		case "aqview":
		case "bam1022":
		case "aqlite":
			return "triangle";
		default:
			return "circle";
	}
}

/** monitor-map's draw order (`getOrder`): higher draws on top. Unknown types draw lowest. */
function monitorOrder(props: MonitorFeatureProperties): number {
	switch (props.type) {
		case "airgradient":
			return 5;
		case "airnow":
			return 2;
		case "aqview":
			return 3;
		case "bam1022":
			return 6;
		case "purpleair":
			return props.isSjvair ? 4 : 1;
		case "vozbox":
			return 7;
		case "aqlite":
			return 8;
		default:
			return 0;
	}
}

/** The marker drawing for each shape. */
export const SHAPES = { circle, square, triangle };
const ICON_SIZE = 24;
const BORDER_WIDTH = 2;
export const CLUSTER_RADIUS = 40;
export const CLUSTER_MAX_ZOOM = 9;
const CLUSTER_OPACITY = 0.8;
/** Cluster icons grow with the count: 1.3×, then 1.6× from 10, then 2× from 25. */
const CLUSTER_SIZES = [1.3, 10, 1.6, 25, 2.0];

/** `shape:location`, e.g. "triangle:inside". */
function category(props: MonitorFeatureProperties): string {
	return `${monitorShape(props.type)}:${props.location === "inside" ? "inside" : "outside"}`;
}

/** Readings by `numericValue`'s rule (numbers and numeric strings), as levels and tooltips count. */
const IS_READING = hasNumericValue("value");
const COUNT: ExpressionSpecification = ["get", "countValues"];
const MEAN: ExpressionSpecification = ["/", ["get", "sumValues"], ["max", COUNT, 1]];
/** The cluster's average reading, or MISSING_VALUE when none of its monitors has one. */
const AVERAGE: ExpressionSpecification = ["case", [">", COUNT, 0], MEAN, MISSING_VALUE];

/** Readable text on `color`, or `fallback` for an unparseable color. */
function readable(color: string, fallback: string): string {
	return levelChip(color)?.text ?? fallback;
}

/** A type's cluster: its shape colored by the average's level, with the rounded average on it. */
function clusterLayers({
	group,
	sourceId,
	scale,
	theme,
	iconImage,
	iconSizeScale
}: ClusterLayerArgs) {
	const filter: ExpressionSpecification = ["has", "point_count"];
	const sizes = CLUSTER_SIZES.map((n, i) => (i % 2 === 0 ? n * iconSizeScale : n));
	return [
		{
			local: "cluster-icon",
			spec: {
				type: "symbol" as const,
				source: sourceId,
				filter,
				layout: {
					"icon-image": iconImage(
						`${monitorShape(group)}:outside`,
						levelKeyExpression(scale, AVERAGE)
					),
					"icon-size": [
						"step",
						["get", "point_count"],
						...sizes
					] as unknown as ExpressionSpecification,
					"icon-ignore-placement": true,
					"icon-allow-overlap": true
				},
				paint: { "icon-opacity": CLUSTER_OPACITY }
			}
		},
		{
			local: "cluster-average",
			spec: {
				type: "symbol" as const,
				source: sourceId,
				filter,
				layout: {
					"text-field": [
						"case",
						[">", COUNT, 0],
						["to-string", ["round", MEAN]],
						""
					] as ExpressionSpecification,
					"text-size": 12,
					"text-ignore-placement": true,
					"text-allow-overlap": true
				},
				paint: {
					"text-color": levelLookup(
						scale,
						AVERAGE,
						readable(theme.neutral, theme.foreground),
						(l) => readable(l.color || theme.neutral, theme.foreground)
					)
				}
			}
		}
	];
}

/**
 * A snippet that mounts `component` with `props` (a tooltip outside the map's component tree).
 * It mounts at once; `late`, when given, updates the props once it resolves (e.g. a note that
 * needs a lookup), so a slow lookup never leaves an empty card. Nothing is mounted or updated
 * after the tooltip closes, and a failure to mount or update is logged, not thrown.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function componentSnippet<Props extends Record<string, any>>(
	component: Component<Props>,
	props: Props,
	late?: Promise<Partial<Props>>
): Snippet {
	return createRawSnippet(() => ({
		render: () => "<div></div>",
		setup(target) {
			let instance: ReturnType<typeof mount> | undefined;
			let closed = false;
			const live = reactiveProps(props);
			try {
				instance = mount(component, { target, props: live });
			} catch (error) {
				console.error("map-sdk: a tooltip failed to mount", error);
			}
			void late?.then((extra) => {
				if (closed || !instance) return;
				try {
					Object.assign(live, extra);
				} catch (error) {
					console.error("map-sdk: a tooltip failed to update", error);
				}
			});
			return () => {
				closed = true;
				if (instance) void unmount(instance);
			};
		}
	}));
}

/**
 * Looks up a monitor type's reporting interval (e.g. "1 hour") for tooltips' "(N avg)" note,
 * once per type; null when the provider has none. Failures (a rejection or a synchronous throw)
 * give null and are forgotten, so they're retried.
 */
export function intervalLookup(): (
	type: string,
	metadata: MetadataProvider
) => Promise<string | null> {
	const intervals = new Map<string, Promise<string | null>>();
	return function intervalFor(type, metadata) {
		if (!metadata.monitorTypeInterval) return Promise.resolve(null);
		let found = intervals.get(type);
		if (!found) {
			let call: Promise<string>;
			try {
				call = Promise.resolve(metadata.monitorTypeInterval(type));
			} catch {
				return Promise.resolve(null);
			}
			const lookup = call.then(
				(value) => (value === "unavailable" ? null : value),
				() => null
			);
			found = lookup;
			intervals.set(type, lookup);
			void lookup.then((value) => {
				if (value === null && intervals.get(type) === lookup) intervals.delete(type);
			});
		}
		return found;
	};
}

/**
 * Air-quality monitors as on today's live map: a shape per monitor type filled with its level's
 * color, inactive monitors in the neutral color, inside monitors outlined, and per-type clusters
 * colored by their average that zoom in when clicked.
 */
export function monitorsPlugin(options: MonitorsPluginOptions): MapPlugin {
	const clustered = options.clustered ?? true;
	const intervalFor = intervalLookup();
	return pointsPlugin<MonitorFeatureProperties>({
		id: options.id ?? "monitors",
		source: options.source,
		layerLabel: options.layerLabel,
		legendTitle: "entry-type",
		selectable: options.selectable ?? true,
		selectedStyle: options.selectedStyle,
		icon: {
			category,
			draw(cat, color) {
				const [shape, location] = cat.split(":") as [MonitorShape, string];
				return SHAPES[shape](
					color,
					BORDER_WIDTH,
					location === "inside" ? MONITOR_INSIDE_OUTLINE : undefined
				);
			},
			size: ICON_SIZE,
			muted: (props) => !props.isActive,
			mutedColor: MONITOR_INACTIVE_COLOR
		},
		sortKey: monitorOrder,
		cluster: clustered
			? {
					radius: CLUSTER_RADIUS,
					maxZoom: CLUSTER_MAX_ZOOM,
					groupBy: (props) => props.type,
					properties: {
						sumValues: ["+", ["case", IS_READING, ["to-number", ["get", "value"], 0], 0]],
						countValues: ["+", ["case", IS_READING, 1, 0]]
					},
					layers: clusterLayers,
					tooltip: (cluster, env) =>
						componentSnippet(MonitorClusterTooltip, {
							cluster,
							scale: env.scale,
							messages: env.messages,
							format: env.format,
							metadata: env.metadata
						})
				}
			: undefined,
		tooltipShowsName: true,
		tooltip: (item, props, env) =>
			componentSnippet<ComponentProps<typeof MonitorTooltip>>(
				MonitorTooltip,
				{
					item,
					timestamp: props.timestamp ?? null,
					scale: env.scale,
					messages: env.messages,
					format: env.format,
					interval: null
				},
				intervalFor(props.type, env.metadata).then((interval) => ({ interval }))
			)
	});
}
