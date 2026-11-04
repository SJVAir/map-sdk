import clustersDbscan from "@turf/clusters-dbscan";
import { featureCollection, point } from "@turf/helpers";

// Ported from monitor-map 4.3.0 (src/lib/hms/hms.svelte.ts, computeFireGroups).

/** Fires within this distance (km) of each other share a group. */
const EPSILON_KM = 2;
const MIN_POINTS = 1;

export interface FireGroup {
	id: string;
	/** Mean [lng, lat] of the group's fires. */
	coordinates: [number, number];
	/** Mean fire radiative power of the group's fires. */
	avgFrp: number;
	count: number;
}

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

/** Groups nearby fires (DBSCAN, 2 km, every fire its own seed) into one point per group. */
export function groupFires(
	fires: Array<{ id: string; coordinates: [number, number]; frp: number }>
): FireGroup[] {
	if (!fires.length) return [];
	const clustered = clustersDbscan(
		featureCollection(fires.map((f) => point(f.coordinates, { fireId: f.id, frp: f.frp }))),
		EPSILON_KM,
		{ minPoints: MIN_POINTS, units: "kilometers" }
	);
	const groups = new Map<string, { frps: number[]; lngs: number[]; lats: number[] }>();
	for (const feature of clustered.features) {
		const props = feature.properties as {
			dbscan: "core" | "edge" | "noise";
			cluster?: number;
			fireId: string;
			frp: number;
		};
		// With minPoints 1 every fire is a core point, so "noise" never occurs.
		const key = props.dbscan === "noise" ? `noise-${props.fireId}` : `cluster-${props.cluster}`;
		const [lng, lat] = feature.geometry.coordinates;
		const entry = groups.get(key) ?? { frps: [], lngs: [], lats: [] };
		entry.frps.push(props.frp);
		entry.lngs.push(lng);
		entry.lats.push(lat);
		groups.set(key, entry);
	}
	return [...groups].map(([key, { frps, lngs, lats }]) => ({
		id: `hms-fire-group-${key}`,
		coordinates: [mean(lngs), mean(lats)],
		avgFrp: mean(frps),
		count: frps.length
	}));
}
