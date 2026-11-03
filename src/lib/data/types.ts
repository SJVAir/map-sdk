import type { FeatureCollection, Geometry } from "geojson";
import type { Scale, ScaleRef } from "./scale-types.js";

export type FeatureRef =
	| { kind: "monitor"; id: string }
	| { kind: "region"; type: string; code: string }
	| { kind: "feature"; id: string }; // not selectable (smoke polygons, fires)

export type SpatialSelection = { kind: "monitors" | "regions"; ids: string[] }; // dashboard shape

export type SelectionMode = "none" | "single" | "multiple";

export interface MapFeatureProperties {
	refKey: string;
	name: string;
	value: number | string | null;
}

export type DataStatus =
	| { state: "loading" }
	| { state: "ready" }
	| { state: "error"; error: unknown; retry(): void }
	| { state: "unavailable"; reason: string };

export interface DataSource<P extends MapFeatureProperties = MapFeatureProperties> {
	readonly status: DataStatus;
	readonly features: FeatureCollection<Geometry, P> | null;
	readonly scale: ScaleRef | Scale | null;
}
