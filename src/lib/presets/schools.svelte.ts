import { untrack } from "svelte";
import type { FeatureCollection, Geometry, Point } from "geojson";
import type { ClusterLayers } from "../plugins/points-clusters.js";
import { CLUSTERED } from "../plugins/points-clusters.js";
import type { LegendData, MapPlugin, PluginContext } from "../core/plugin.js";
import { defaultMessages, type MessageProvider } from "../data/messages.js";
import { encodeRef } from "../data/refs.js";
import type {
	DataSource,
	DataStatus,
	LocationType,
	MapFeatureProperties,
	SchoolLocationProperties,
	SchoolsSource
} from "../data/types.js";
import { pointsPlugin } from "../plugins/points.svelte.js";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS, componentSnippet } from "./monitors.js";
import SchoolClusterTooltip from "./SchoolClusterTooltip.svelte";
import { badgeKindOf, SCHOOL_BADGE_SIZE, schoolBadge, schoolBadgeMarkup } from "./school-icons.js";
import SchoolTooltip from "./SchoolTooltip.svelte";

export interface SchoolsPluginOptions {
	/** Default "schools". */
	id?: string;
	/**
	 * The sites, as `getPesticideLocations` returns them (a plain
	 * `{ status: { state: "ready" }, features }` will do). The preset never fetches.
	 */
	source: SchoolsSource;
	/** Already-translated layer name for the list, summary, and legend title. */
	layerLabel: string;
	/** The types to draw: an allow-list. Default: all three (and any other type the data has). */
	types?: readonly LocationType[];
	/** Default: every zoom. */
	zoomRange?: { min?: number; max?: number };
}

/** The legend's and bubbles' order. */
const TYPES: readonly LocationType[] = ["public_school", "private_school", "child_care"];

/** What the points plugin draws: the host's properties plus a ref key, name, and no value. */
type SchoolPointProperties = SchoolLocationProperties & MapFeatureProperties;

const BUBBLE_RADIUS = 14;

/** The host's source as points: allowed types only, each with its `refKey`. */
class SchoolPoints implements DataSource<SchoolPointProperties> {
	readonly scale = null;
	#host: SchoolsSource;
	#allowed: ReadonlySet<string> | null;
	readonly features = $derived.by((): FeatureCollection<Geometry, SchoolPointProperties> | null => {
		const collection = this.#host.features;
		if (!collection) return null;
		const features = [];
		for (const feature of collection.features) {
			const props = feature.properties;
			if (!props || feature.geometry?.type !== "Point") continue;
			if (this.#allowed && !this.#allowed.has(props.type)) continue;
			features.push({
				type: "Feature" as const,
				geometry: feature.geometry as Point,
				properties: {
					...props,
					refKey: encodeRef({ kind: "feature", id: props.id }),
					value: null
				}
			});
		}
		return { type: "FeatureCollection", features };
	});

	constructor(host: SchoolsSource, types: readonly LocationType[] | undefined) {
		this.#host = host;
		this.#allowed = types ? new Set(types) : null;
	}

	get status(): DataStatus {
		return this.#host.status;
	}
}

/**
 * Public schools, private schools, and child care sites: a school-house badge with a school or
 * baby glyph (Lucide's), in the `--school-marker` or `--child-care-marker` color, gathered into
 * count bubbles per kind when zoomed out. The type's label (from the metadata provider's
 * `locationTypeLabel`, else the feature's `type_label`) is its list detail, card line, and legend
 * entry, so public and private tell apart by label. Not selectable. `featureclick` carries the
 * host's properties (`source`, `external_id`). A focus point at a site's exact coordinates gives
 * way to the site's own marker and row while it's drawn.
 */
export function schoolsPlugin(options: SchoolsPluginOptions): MapPlugin {
	const pluginId = options.id ?? "schools";
	const { layerLabel } = options;
	const points = new SchoolPoints(options.source, options.types);
	const shownTypes = options.types ? TYPES.filter((t) => options.types!.includes(t)) : TYPES;

	/** Type → label from the metadata, once answered. */
	let labels = $state.raw<Readonly<Record<string, string>>>({});
	/** The running setup's messages; the defaults before setup. */
	let messages = $state.raw<MessageProvider>(defaultMessages);

	function labelOf(type: string, typeLabel?: string | null): string {
		if (Object.hasOwn(labels, type)) return labels[type];
		return typeLabel?.trim() || messages("mapsdk_location_type_unknown");
	}

	/** A type's label for the legend and bubbles: metadata, else any site's own label. */
	function labelOfType(type: string): string {
		if (Object.hasOwn(labels, type)) return labels[type];
		const site = points.features?.features.find((f) => f.properties.type === type);
		return labelOf(type, site?.properties.type_label);
	}

	const plugin = pointsPlugin<SchoolPointProperties>({
		id: pluginId,
		source: points,
		layerLabel,
		selectable: false,
		marksPlaces: true,
		zoomRange: options.zoomRange,
		icon: {
			category: (props) => badgeKindOf(props.type),
			draw: (category, _color, theme) =>
				category === "child-care"
					? schoolBadge("child-care", theme.childCareMarker)
					: schoolBadge("school", theme.schoolMarker),
			size: SCHOOL_BADGE_SIZE
		},
		detail: (props) => labelOf(props.type, props.type_label),
		cluster: {
			radius: CLUSTER_RADIUS,
			maxZoom: CLUSTER_MAX_ZOOM,
			groupBy: (props) => badgeKindOf(props.type),
			properties: Object.fromEntries(
				TYPES.map((type) => [type, ["+", ["case", ["==", ["get", "type"], type], 1, 0]]])
			),
			layers: ({ group, sourceId, theme }): ClusterLayers => [
				{
					local: "clusters",
					spec: {
						type: "circle",
						source: sourceId,
						filter: CLUSTERED,
						paint: {
							"circle-radius": BUBBLE_RADIUS,
							"circle-color": group === "child-care" ? theme.childCareMarker : theme.schoolMarker,
							"circle-stroke-color": "#ffffff",
							"circle-stroke-width": 1.5
						}
					}
				},
				{
					local: "cluster-count",
					spec: {
						type: "symbol",
						source: sourceId,
						filter: CLUSTERED,
						layout: {
							"text-field": ["get", "point_count_abbreviated"],
							"text-size": 12,
							"text-allow-overlap": true
						},
						paint: { "text-color": "#ffffff" }
					}
				}
			],
			tooltip: (cluster, env) =>
				componentSnippet(SchoolClusterTooltip, {
					counts: TYPES.map((type) => ({
						label: labelOfType(type),
						count: Number(cluster.properties[type] ?? 0)
					})).filter((c) => c.count > 0),
					messages: env.messages,
					format: env.format
				})
		},
		tooltip: (_item, props, env) =>
			componentSnippet(SchoolTooltip, {
				site: props,
				typeLabel: labelOf(props.type, props.type_label),
				messages: env.messages,
				format: env.format
			})
	});

	plugin.properties = (refKey) => {
		const found = untrack(() =>
			options.source.features?.features.find(
				(f) => f.properties && encodeRef({ kind: "feature", id: f.properties.id }) === refKey
			)
		);
		return found?.properties ? $state.snapshot(found.properties) : undefined;
	};

	plugin.legend = (): LegendData | null => {
		const status = options.source.status;
		if (status.state !== "ready") return { pluginId, status };
		return {
			pluginId,
			title: layerLabel,
			symbols: shownTypes.map((type) => ({
				label: labelOfType(type),
				markup: schoolBadgeMarkup(badgeKindOf(type), 16)
			}))
		};
	};

	const setup = plugin.setup;
	plugin.setup = (ctx: PluginContext) => {
		messages = ctx.messages;
		const controller = new AbortController();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
		const asked = new Set<string>();
		ctx.effect(() => {
			// The legend's types, and any other type the data has.
			const types = [
				...shownTypes,
				...(points.features?.features ?? []).map((f) => f.properties.type)
			];
			untrack(() => {
				for (const type of types) {
					if (asked.has(type) || Object.hasOwn(labels, type)) continue;
					asked.add(type);
					void lookUp(ctx, type, controller.signal);
				}
			});
		});
		const teardown = setup(ctx);
		return () => {
			controller.abort();
			teardown();
		};
	};

	async function lookUp(ctx: PluginContext, type: string, signal: AbortSignal): Promise<void> {
		const { metadata } = ctx;
		if (!metadata.locationTypeLabel) return;
		try {
			const label = await metadata.locationTypeLabel(type, signal);
			if (signal.aborted || label === "unavailable" || !label.trim()) return;
			labels = { ...labels, [type]: label };
		} catch {
			// An abort or a failed provider: the feature's own label stays.
		}
	}

	return plugin;
}
