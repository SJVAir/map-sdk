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

/** A monitor on the map: what the monitors preset draws and its tooltips show. */
export interface MonitorFeatureProperties extends MapFeatureProperties {
	/** The server's monitor type (e.g. "purpleair", "airnow"); picks the marker shape. */
	type: string;
	isActive: boolean;
	isSjvair: boolean;
	location: "inside" | "outside";
	/** When the reading was taken (ISO 8601), for the tooltip. */
	timestamp?: string | null;
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

/**
 * A collocation site: drawn at its reference monitor with that monitor's type, location,
 * activity, and reading, plus the collocated monitor's reading. Readings are null when a
 * monitor isn't in the monitors store (inactive, filtered out, or not loaded yet).
 */
export interface CollocationFeatureProperties extends MonitorFeatureProperties {
	colocatedId: string;
	/** Null when the collocated monitor isn't in the monitors store. */
	colocatedName: string | null;
	/** The collocated monitor's type, for its tooltip's "(N avg)" note; null when unknown. */
	colocatedType: string | null;
	colocatedValue: number | null;
	colocatedTimestamp: string | null;
}
