import type { Feature, MultiPolygon } from "geojson";
import raw from "./hms-smoke-plume-2026-11-08.json";

/**
 * The local HMS smoke plume of 2026-11-08 (light, GOES-WEST), saved by monitor-map-72: it covers
 * the Valley's default view, but its centroid is off Baja (about -121.2, 32.5).
 */
export function plumeFeature(): Feature<
	MultiPolygon,
	{ refKey: string; name: string; value: string }
> {
	const plume = raw.data[0];
	return {
		type: "Feature",
		geometry: structuredClone(plume.geometry) as MultiPolygon,
		properties: { refKey: `feature:${plume.id}`, name: "Smoke", value: plume.density }
	};
}
