import type { ExpressionSpecification, FilterSpecification } from "@maptiler/sdk";
import type { Feature } from "geojson";
import type { GlMapLike } from "../core/gl.js";
import type { BlockingClick, FeatureHit, LayerSpecWithoutId } from "../core/plugin.js";
import { encodeRef } from "../data/refs.js";
import type { Scale } from "../data/scale-types.js";
import type { MapFeatureProperties } from "../data/types.js";
import type { ThemeColors } from "./style.js";

// Cluster bubbles for the points plugin: their default look, the hover hit that names one, its
// leaves, and click-to-zoom. Bubbles are blocking layers: the interaction router hides what is
// beneath them and routes their clicks here.

/** A hovered cluster bubble. */
export interface ClusterInfo<P extends MapFeatureProperties> {
	group: string;
	pointCount: number;
	/** The cluster feature's properties, including `cluster.properties` aggregates. */
	properties: Readonly<Record<string, unknown>>;
	/** Every point in the cluster; rejects if the cluster is gone, empty once torn down. */
	leaves(): Promise<Array<{ props: P; lngLat: [number, number] }>>;
}

/** What custom cluster layers are built from. */
export interface ClusterLayerArgs {
	group: string;
	sourceId: string;
	scale: Scale;
	theme: ThemeColors;
	/**
	 * The `icon-image` for the plugin's icon of `category` at the level `levelKey` evaluates to
	 * (use `levelKeyExpression`); registers that category's images.
	 */
	iconImage(category: string, levelKey: ExpressionSpecification): ExpressionSpecification;
	/** The `icon-size` that shows an icon at its `size` (images are drawn larger for HiDPI). */
	iconSizeScale: number;
}

export type ClusterLayers = Array<{ local: string; spec: LayerSpecWithoutId }>;

export const CLUSTERED: FilterSpecification = ["has", "point_count"];

/** The part of MapLibre's `GeoJSONSource` clusters use. */
interface ClusterSource {
	getClusterExpansionZoom(clusterId: number): Promise<number>;
	getClusterLeaves(clusterId: number, limit: number, offset: number): Promise<Feature[]>;
}

function prefersReducedMotion(): boolean {
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Cluster bubbles: a neutral circle with the count. */
export function defaultClusterLayers({ sourceId, theme }: ClusterLayerArgs): ClusterLayers {
	return [
		{
			local: "clusters",
			spec: {
				type: "circle",
				source: sourceId,
				filter: CLUSTERED,
				paint: {
					"circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 25, 20],
					"circle-color": theme.neutral,
					"circle-stroke-color": theme.foreground,
					"circle-stroke-width": 1
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
				paint: { "text-color": theme.foreground }
			}
		}
	];
}

/** What a cluster hover hit names: the data generation it was hovered in, the id, the group. */
export interface ClusterRef {
	generation: number;
	clusterId: number;
	group: string;
}

const CLUSTER_ID = /^cluster:(\d+):(\d+):(.*)$/s;

/**
 * The hover hit for a bubble: a `{ kind: "feature", id: "cluster:<generation>:<id>:<group>" }`
 * ref (cluster ids are only meaningful for the data they were made from) carrying the bubble's
 * properties. No side effects: lookups call it too.
 */
export function clusterHit(
	pluginId: string,
	generation: number,
	group: string,
	props: Record<string, unknown>
): FeatureHit | null {
	const clusterId = props.cluster_id;
	if (typeof clusterId !== "number") return null;
	const ref = { kind: "feature" as const, id: `cluster:${generation}:${clusterId}:${group}` };
	return { pluginId, ref, refKey: encodeRef(ref), name: "", properties: { ...props } };
}

/** The cluster a hover hit names, or null for any other hit. */
export function parseClusterHit(hit: FeatureHit): ClusterRef | null {
	if (hit.ref.kind !== "feature") return null;
	const match = CLUSTER_ID.exec(hit.ref.id);
	if (!match) return null;
	return { generation: Number(match[1]), clusterId: Number(match[2]), group: match[3] };
}

/** A cluster's points, from its source; `[]` once `isDead`. */
export async function clusterLeaves<P extends MapFeatureProperties>(
	gl: GlMapLike,
	sourceId: string,
	clusterId: number,
	pointCount: number,
	isDead: () => boolean
): Promise<Array<{ props: P; lngLat: [number, number] }>> {
	const clusters = isDead() ? undefined : (gl.getSource(sourceId) as ClusterSource | undefined);
	if (!clusters) return [];
	const leaves = await clusters.getClusterLeaves(clusterId, pointCount, 0);
	if (isDead()) return [];
	return leaves.flatMap((leaf) =>
		leaf.geometry.type === "Point"
			? [
					{
						props: leaf.properties as P,
						lngLat: leaf.geometry.coordinates.slice(0, 2) as [number, number]
					}
				]
			: []
	);
}

/** Zooms in far enough to expand a clicked bubble; no animation under reduced motion. */
export function zoomIntoCluster(
	gl: GlMapLike,
	sourceId: string,
	feature: BlockingClick,
	isDead: () => boolean,
	pluginId: string
): void {
	const clusterId = feature.properties.cluster_id;
	if (typeof clusterId !== "number" || feature.geometry.type !== "Point") return;
	const [lng, lat] = feature.geometry.coordinates;
	const clusters = gl.getSource(sourceId) as ClusterSource | undefined;
	clusters?.getClusterExpansionZoom(clusterId).then(
		(zoom) => {
			if (isDead()) return;
			gl.easeTo({ center: [lng, lat], zoom, ...(prefersReducedMotion() && { duration: 0 }) });
		},
		(error: unknown) => {
			if (!isDead())
				console.warn(`map-sdk: plugin "${pluginId}" could not expand a cluster`, error);
		}
	);
}
