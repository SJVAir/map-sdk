import type { FeatureCollection, Geometry, Point } from "geojson";
import type {
	DataSource,
	DataStatus,
	MapFeatureProperties,
	SchoolLocationProperties,
	SchoolsSource
} from "../../src/lib/data/types.js";
import type { Scale, ScaleRef } from "../../src/lib/data/scale-types.js";

/** A writable, reactive `DataSource` for tests. */
export class TestSource<
	P extends MapFeatureProperties = MapFeatureProperties
> implements DataSource<P> {
	status = $state.raw<DataStatus>({ state: "ready" });
	features = $state.raw<FeatureCollection<Geometry, P> | null>(null);
	scale = $state.raw<ScaleRef | Scale | null>(null);

	constructor(init: {
		features?: FeatureCollection<Geometry, P> | null;
		scale?: ScaleRef | Scale | null;
	}) {
		this.features = init.features ?? null;
		this.scale = init.scale ?? null;
	}
}

/** A point feature collection, one feature per property row (with an optional `lngLat`). */
export function points<P extends MapFeatureProperties>(
	rows: Array<P & { lngLat?: [number, number] }>
): FeatureCollection<Point, P> {
	return {
		type: "FeatureCollection",
		features: rows.map(({ lngLat, ...props }, i) => ({
			type: "Feature",
			geometry: { type: "Point", coordinates: lngLat ?? [-119 - i * 0.01, 36.5] },
			properties: props as unknown as P
		}))
	};
}

/** A reactive boolean for tests (runes only compile in `.svelte.ts` files). */
export class Flag {
	value = $state(false);
}

type SchoolRow = Partial<SchoolLocationProperties> & { at?: [number, number] };

/** School features as `getPesticideLocations` gives them: ids `s1`, `s2`…, public by default. */
export function schoolRows(rows: SchoolRow[]): FeatureCollection<Point, SchoolLocationProperties> {
	return {
		type: "FeatureCollection",
		features: rows.map(({ at, ...props }, i) => ({
			type: "Feature",
			geometry: { type: "Point", coordinates: at ?? [-119.8 + i * 0.01, 36.75] },
			properties: {
				id: `s${i + 1}`,
				name: `Site ${i + 1}`,
				type: "public_school",
				type_label: "Public School (CDE)",
				...props
			}
		}))
	};
}

/** A host's plain schools source with reactive status and features. */
export class SchoolsTestSource implements SchoolsSource {
	status = $state.raw<DataStatus>({ state: "ready" });
	features = $state.raw<FeatureCollection<Point, SchoolLocationProperties> | null>(null);
	constructor(rows: SchoolRow[]) {
		this.features = schoolRows(rows);
	}
}

/** A reactive list of feature-list items, for a plugin whose `features()` changes at a still view. */
export class ItemsBox<T> {
	items = $state.raw<T[]>([]);
	constructor(items: T[]) {
		this.items = items;
	}
}
