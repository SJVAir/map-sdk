import type { FeatureCollection, Geometry } from "geojson";
import type { Scale, ScaleRef } from "./scale-types.js";
import type { DataSource, MapFeatureProperties } from "./types.js";

export function staticSource<P extends MapFeatureProperties>(
	features: FeatureCollection<Geometry, P>,
	scale: ScaleRef | Scale | null
): DataSource<P> {
	return { status: { state: "ready" }, features, scale };
}
