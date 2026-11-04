import type { ExpressionSpecification } from "@maptiler/sdk";
import { createRawSnippet, mount, unmount, type Component, type Snippet } from "svelte";
import type { MapPlugin } from "../core/plugin.js";
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
import MonitorClusterTooltip from "./MonitorClusterTooltip.svelte";
import MonitorTooltip from "./MonitorTooltip.svelte";

// Ported from monitor-map 4.3.0 (src/lib/monitors/): shapes, draw order, icon variants, and
// cluster rendering. Shapes, sizes, and order are presentation; colors come from the scale and
// the theme.

export interface MonitorsPluginOptions {
	/** Default "monitors". */
	id?: string;
	source: DataSource<MonitorFeatureProperties>;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	/** Default true, like the shape presets. */
	selectable?: boolean;
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

const SHAPES = { circle, square, triangle };
const ICON_SIZE = 24;
const BORDER_WIDTH = 2;
const CLUSTER_RADIUS = 40;
const CLUSTER_MAX_ZOOM = 9;
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

/** A snippet that mounts `component` with `props` (a tooltip outside the map's component tree). */
function componentSnippet<Props extends Record<string, unknown>>(
	component: Component<Props>,
	props: Props
): Snippet {
	return createRawSnippet(() => ({
		render: () => "<div></div>",
		setup(target) {
			const instance = mount(component, { target, props });
			return () => {
				void unmount(instance);
			};
		}
	}));
}

/**
 * Air-quality monitors as on today's live map: a shape per monitor type filled with its level's
 * color, inactive monitors in the neutral color, inside monitors outlined, and per-type clusters
 * colored by their average that zoom in when clicked.
 */
export function monitorsPlugin(options: MonitorsPluginOptions): MapPlugin {
	const clustered = options.clustered ?? true;
	return pointsPlugin<MonitorFeatureProperties>({
		id: options.id ?? "monitors",
		source: options.source,
		layerLabel: options.layerLabel,
		selectable: options.selectable ?? true,
		icon: {
			category,
			draw(cat, color, theme) {
				const [shape, location] = cat.split(":") as [MonitorShape, string];
				return SHAPES[shape](
					color,
					BORDER_WIDTH,
					location === "inside" ? theme.foreground : undefined
				);
			},
			size: ICON_SIZE,
			muted: (props) => !props.isActive
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
		tooltip: (item, props, env) =>
			componentSnippet(MonitorTooltip, {
				item,
				timestamp: props.timestamp ?? null,
				scale: env.scale,
				messages: env.messages,
				format: env.format
			})
	});
}
