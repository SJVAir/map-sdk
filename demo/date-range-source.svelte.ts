import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import {
	getCalHeatScores,
	getForecasts,
	getHMSFire,
	getHMSSmoke,
	getMonitorSummariesBulkDaily,
	getRegionsGeoJSON,
	getRegionSummariesBulkDaily,
	type MonitorEntryType,
	type RegionType
} from "@sjvair/sdk";
import { groupFires } from "../src/lib/index.js";
import {
	encodeRef,
	type DataSource,
	type DataStatus,
	type MapFeatureProperties,
	type MonitorFeatureProperties,
	type ScaleRef
} from "../src/lib/data/index.js";

/*
 * A small stand-in for the dashboard's data layer: each preset's features for a date range,
 * fetched with @sjvair/sdk. Monitors and regions average their daily summaries over the range;
 * the day-based datasets (CalHeatScore, forecasts, HMS) show the range's last day.
 */

export type SourceKind =
	"monitors" | "regions" | "calheatscore" | "forecast-zones" | "hms-smoke" | "hms-fire";

export interface DateRange {
	/** `YYYY-MM-DD`, inclusive. */
	start: string;
	/** `YYYY-MM-DD`, inclusive. */
	end: string;
}

export interface DateRangeSource extends DataSource {
	/** Stops following the range. */
	destroy(): void;
}

type Collection = FeatureCollection<Geometry, MapFeatureProperties>;
type Loader = (range: DateRange, entryType: string, signal: AbortSignal) => Promise<Collection>;

const collection = (features: Feature<Geometry, MapFeatureProperties>[]): Collection => ({
	type: "FeatureCollection",
	features
});

const average = (values: number[]) =>
	values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

/** Region boundaries keyed by code, from the regions GeoJSON wrapper (it batches long lists). */
async function boundaries(type: RegionType, codes: string[], signal: AbortSignal) {
	const simplify = type === "county" || type === "zipcode" || type === "tract";
	const shapes = await getRegionsGeoJSON({ type, simplify, external_id: codes }, { signal });
	return new Map(
		shapes.features.flatMap((f) =>
			f.properties.external_id ? [[f.properties.external_id, f as Feature<Geometry>]] : []
		)
	);
}

/** A region feature: its refKey is the stable `region:<type>:<code>`, never the server's id. */
function regionFeature(
	shape: Feature<Geometry>,
	type: string,
	code: string,
	name: string,
	value: number | null
): Feature<Geometry, MapFeatureProperties> {
	const refKey = encodeRef({ kind: "region", type, code });
	return { type: "Feature", geometry: shape.geometry, properties: { refKey, name, value } };
}

const loaders: Record<SourceKind, Loader> = {
	async monitors(range, entryType, signal) {
		const monitors = await getMonitorSummariesBulkDaily(
			{ entryType: entryType as MonitorEntryType, ...range },
			{ signal }
		);
		return collection(
			monitors.flatMap((m) => {
				if (!m.position) return [];
				const properties: MonitorFeatureProperties = {
					refKey: encodeRef({ kind: "monitor", id: m.id }),
					name: m.name,
					value: average(m.summaries.map((s) => s.mean)),
					type: m.type,
					isActive: m.is_active,
					isSjvair: m.is_sjvair,
					location: m.location === "inside" ? "inside" : "outside"
				};
				const geometry: Point = { type: "Point", coordinates: m.position.coordinates };
				return [{ type: "Feature" as const, geometry, properties }];
			})
		);
	},

	async regions(range, entryType, signal) {
		const shapes = await getRegionsGeoJSON({ type: "county", simplify: true }, { signal });
		const ids = shapes.features.map((f) => f.id);
		const summaries = ids.length
			? await getRegionSummariesBulkDaily({ entryType, ...range, region: ids }, { signal })
			: [];
		const means = new Map(summaries.map((r) => [r.id, average(r.summaries.map((s) => s.mean))]));
		return collection(
			shapes.features.flatMap((f) => {
				const code = f.properties.external_id;
				if (!code) return [];
				const value = means.get(f.id) ?? null;
				return [regionFeature(f as Feature<Geometry>, "county", code, f.properties.name, value)];
			})
		);
	},

	async calheatscore(range, _entryType, signal) {
		const scores = await getCalHeatScores({ date: range.end }, { signal });
		const shapes = await boundaries(
			"zipcode",
			scores.map((s) => s.zipcode),
			signal
		);
		return collection(
			scores.flatMap((s) => {
				const shape = shapes.get(s.zipcode);
				return shape ? [regionFeature(shape, "zipcode", s.zipcode, s.zipcode, s.score)] : [];
			})
		);
	},

	async "forecast-zones"(range, _entryType, signal) {
		const forecasts = await getForecasts({ forecast_date: range.end }, { signal });
		// A zone can have several issues for the day; the latest wins (later entries replace
		// earlier ones in the Map).
		const byPublished = forecasts.toSorted((a, b) => a.published_at.localeCompare(b.published_at));
		const latest = new Map(byPublished.map((f) => [`${f.region.type}:${f.region.external_id}`, f]));
		const types = [...new Set([...latest.values()].map((f) => f.region.type))];
		const shapesByType = new Map(
			await Promise.all(
				types.map(async (type) => {
					const codes = [...latest.values()]
						.filter((f) => f.region.type === type)
						.map((f) => f.region.external_id);
					return [type, await boundaries(type, codes, signal)] as const;
				})
			)
		);
		return collection(
			[...latest.values()].flatMap((f) => {
				const shape = shapesByType.get(f.region.type)?.get(f.region.external_id);
				return shape
					? [regionFeature(shape, f.region.type, f.region.external_id, f.zone_name, f.aqi_value)]
					: [];
			})
		);
	},

	async "hms-smoke"(range, _entryType, signal) {
		const smoke = await getHMSSmoke({ date: range.end }, { signal });
		return collection(
			smoke.map((s) => ({
				type: "Feature",
				geometry: s.geometry as Geometry,
				properties: {
					refKey: encodeRef({ kind: "feature", id: s.id }),
					name: "Smoke",
					value: s.density
				}
			}))
		);
	},

	async "hms-fire"(range, _entryType, signal) {
		const fires = await getHMSFire({ date: range.end }, { signal });
		const groups = groupFires(
			fires.map((f) => ({
				id: f.id,
				coordinates: f.geometry.coordinates as [number, number],
				frp: f.frp,
				timestamp: f.timestamp
			}))
		);
		return collection(
			groups.map((g) => ({
				type: "Feature",
				geometry: { type: "Point", coordinates: g.coordinates },
				properties: {
					refKey: encodeRef({ kind: "feature", id: g.id }),
					name: g.count === 1 ? "Fire detection" : `${g.count} fire detections`,
					value: g.avgFrp
				}
			}))
		);
	}
};

/** The ScaleRef each preset expects (see the presets' docs). */
function scaleFor(kind: SourceKind, entryType: string): ScaleRef {
	switch (kind) {
		case "monitors":
		case "regions":
			return { dataset: "air-quality", entryType };
		case "calheatscore":
			return { dataset: "calheatscore", entryType: "heat-score" };
		case "forecast-zones":
			return { dataset: "forecasts", entryType: "aqi-forecast" };
		case "hms-smoke":
			return { dataset: "hms-smoke", entryType: "smoke-density" };
		case "hms-fire":
			return { dataset: "hms-fire", entryType: "fire-frp" };
	}
}

class RangeSource implements DateRangeSource {
	status = $state.raw<DataStatus>({ state: "loading" });
	features = $state.raw<Collection | null>(null);
	readonly scale: ScaleRef;
	readonly destroy: () => void;
	#attempt = $state(0);

	constructor(kind: SourceKind, range: DateRange, entryType: string) {
		this.scale = scaleFor(kind, entryType);
		this.destroy = $effect.root(() => {
			$effect(() => {
				void this.#attempt;
				const { start, end } = range;
				if (!start || !end || start > end) {
					this.status = { state: "unavailable", reason: "Pick a start date before the end date." };
					return;
				}
				const controller = new AbortController();
				this.status = { state: "loading" };
				loaders[kind]({ start, end }, entryType, controller.signal).then(
					(features) => {
						if (controller.signal.aborted) return;
						this.features = features;
						this.status = { state: "ready" };
					},
					(error: unknown) => {
						if (controller.signal.aborted) return;
						this.status = { state: "error", error, retry: () => this.#attempt++ };
					}
				);
				return () => controller.abort();
			});
		});
	}
}

/**
 * A data source for one preset over a date range. `range` may be reactive state: the source
 * refetches when its dates change. `entryType` (default `pm25`) applies to monitors and regions.
 */
export function createDateRangeSource(
	kind: SourceKind,
	range: DateRange,
	entryType = "pm25"
): DateRangeSource {
	return new RangeSource(kind, range, entryType);
}
