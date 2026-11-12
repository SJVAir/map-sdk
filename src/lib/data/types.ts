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

/** An HMS fire on the map: a group of nearby detections, or a single detection. */
export interface FireFeatureProperties extends MapFeatureProperties {
	/** Set on a group: how many detections it averages. Absent on a single detection. */
	count?: number;
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
	/**
	 * The reference monitor's own name (the tooltip shows it); null when it isn't in the
	 * monitors store.
	 */
	referenceName: string | null;
	colocatedId: string;
	/** Null when the collocated monitor isn't in the monitors store. */
	colocatedName: string | null;
	/** The collocated monitor's type, for its tooltip's "(N avg)" note; null when unknown. */
	colocatedType: string | null;
	colocatedValue: number | null;
	colocatedTimestamp: string | null;
}

/** The kinds of school and child care site the schools preset draws. */
export type LocationType = "public_school" | "private_school" | "child_care";

/**
 * A school or child care site's properties as `@sjvair/sdk`'s `getPesticideLocations` returns
 * them; pass its features through unchanged. `type` is a `LocationType`, or a type a newer server
 * adds.
 */
export interface SchoolLocationProperties {
	id: string;
	/** Where `external_id` comes from (for `getLocationsByCode(source, [external_id])`). */
	source?: string;
	/** The site's official code within its `source`. */
	external_id?: string;
	name: string;
	type: string;
	type_label?: string | null;
	address?: string | null;
	city?: string | null;
	school_district?: string | null;
	school_district_id?: string | null;
	school_district_url?: string | null;
	/** The grades served, such as "K-6". */
	grade_span?: string | null;
	enrollment?: number | null;
	capacity?: number | null;
}

/**
 * What the schools preset reads: a status and the sites' features. Any `DataSource` whose
 * features carry `SchoolLocationProperties` is one, as is a plain
 * `{ status: { state: "ready" }, features }`.
 */
export interface SchoolsSource {
	readonly status: DataStatus;
	readonly features: FeatureCollection<Geometry, SchoolLocationProperties> | null;
}
