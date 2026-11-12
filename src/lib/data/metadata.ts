import {
	getCalHeatScoreMeta,
	getDatasetCatalog,
	getForecastsMeta,
	getHMSMeta,
	getMonitorsMeta,
	getRegionsMeta
} from "@sjvair/sdk";
import type { Scale, ScaleRef } from "./scale-types.js";

export interface EntryTypeInfo {
	label: string;
	units: string;
	/**
	 * Decimal places to show values with (the catalog's display hint), or null when the metadata
	 * gives none.
	 */
	precision: number | null;
}

export interface MetadataProvider {
	scale(ref: ScaleRef, signal?: AbortSignal): Promise<Scale | "unavailable">;
	entryType(ref: ScaleRef, signal?: AbortSignal): Promise<EntryTypeInfo | "unavailable">;
	monitorTypeLabel(type: string, signal?: AbortSignal): Promise<string | "unavailable">;
	/**
	 * How often a monitor type reports (e.g. "2 min"), for the tooltip's "(N avg)" note. Optional:
	 * the note is left out when a host's provider lacks it.
	 */
	monitorTypeInterval?(type: string, signal?: AbortSignal): Promise<string | "unavailable">;
	attribution(dataset: string, signal?: AbortSignal): Promise<string | "unavailable">;
	/**
	 * A location type's label (e.g. "Child care" for `child_care`), from the regions metadata's
	 * `location_types`. Resolves "unavailable" for an unknown type or metadata that can't load,
	 * and rejects only on the caller's abort. Optional: the schools preset falls back to the
	 * feature's own `type_label`, then a generic "Location".
	 */
	locationTypeLabel?(type: string, signal?: AbortSignal): Promise<string | "unavailable">;
}

const AIR_QUALITY = "air-quality";

/** Datasets whose meta carries `scales` keyed by entry-type id. */
const SCALE_DATASETS = ["hms-smoke", "hms-fire", "calheatscore", "forecasts"] as const;
type ScaleDataset = (typeof SCALE_DATASETS)[number];

function hasScales(dataset: string): dataset is ScaleDataset {
	return (SCALE_DATASETS as readonly string[]).includes(dataset);
}

function abortError(): Error {
	return new DOMException("The operation was aborted.", "AbortError");
}

/** Resolve with `promise`, or reject early if `signal` aborts (without touching `promise`). */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

/**
 * Fetch once, share the result, and forget failures so the next call retries. The shared fetch
 * carries no caller signal, so one caller's abort cannot reject it for the others.
 */
function memoize<T>(fetch: () => Promise<T>): (signal?: AbortSignal) => Promise<T> {
	let cached: Promise<T> | undefined;
	return (signal) => {
		if (!cached) {
			const p = fetch();
			cached = p;
			p.catch(() => {
				if (cached === p) cached = undefined;
			});
		}
		return untilAborted(cached, signal);
	};
}

export function createDefaultMetadata(): MetadataProvider {
	const monitorsMeta = memoize(() => getMonitorsMeta());
	const catalog = memoize(() => getDatasetCatalog());
	// The catalog splits HMS into two datasets; one meta carries both scales.
	const hmsMeta = memoize(() => getHMSMeta());
	const regionsMeta = memoize(() => getRegionsMeta());
	const datasetScales: Record<
		ScaleDataset,
		ReturnType<typeof memoize<{ scales: Record<string, Scale> }>>
	> = {
		"hms-smoke": hmsMeta,
		"hms-fire": hmsMeta,
		calheatscore: memoize(() => getCalHeatScoreMeta()),
		forecasts: memoize(() => getForecastsMeta())
	};

	/** The value, `"unavailable"` when `read` finds nothing or the fetch fails; only the caller's abort rejects. */
	async function guarded<T>(
		signal: AbortSignal | undefined,
		read: () => Promise<T | undefined>
	): Promise<T | "unavailable"> {
		try {
			return (await read()) ?? "unavailable";
		} catch (error) {
			if (signal?.aborted) throw error;
			return "unavailable";
		}
	}

	/** The catalog's display precision for an entry type, or null. Only the caller's abort rejects. */
	async function precisionOf(ref: ScaleRef, signal?: AbortSignal): Promise<number | null> {
		try {
			const { datasets } = await catalog(signal);
			const entry = datasets
				.find((d) => d.id === ref.dataset)
				?.entry_types.find((e) => e.id === ref.entryType);
			const precision = entry?.display?.precision;
			return typeof precision === "number" ? precision : null;
		} catch (error) {
			if (signal?.aborted) throw error;
			return null;
		}
	}

	async function entryMeta(ref: ScaleRef, signal?: AbortSignal) {
		if (ref.dataset !== AIR_QUALITY) return undefined;
		return (await monitorsMeta(signal)).entries[ref.entryType];
	}

	return {
		scale: (ref, signal) =>
			guarded(signal, async () => {
				if (hasScales(ref.dataset)) {
					const { scales } = await datasetScales[ref.dataset](signal);
					return Object.hasOwn(scales, ref.entryType) ? scales[ref.entryType] : undefined;
				}
				const entry = await entryMeta(ref, signal);
				return entry?.scale ?? undefined;
			}),
		entryType: (ref, signal) =>
			guarded(signal, async () => {
				let info: Omit<EntryTypeInfo, "precision"> | undefined;
				if (hasScales(ref.dataset)) {
					const { scales } = await datasetScales[ref.dataset](signal);
					const scale = Object.hasOwn(scales, ref.entryType) ? scales[ref.entryType] : undefined;
					info = scale && { label: scale.label, units: scale.units };
				} else {
					const entry = await entryMeta(ref, signal);
					info = entry && { label: entry.label, units: entry.units ?? "" };
				}
				return info && { ...info, precision: await precisionOf(ref, signal) };
			}),
		monitorTypeLabel: (type, signal) =>
			guarded(signal, async () => (await monitorsMeta(signal)).monitors[type]?.label),
		monitorTypeInterval: (type, signal) =>
			guarded(signal, async () => (await monitorsMeta(signal)).monitors[type]?.expected_interval),
		locationTypeLabel: (type, signal) =>
			guarded(signal, async () => {
				const types: Partial<Record<string, { label: string }>> = (await regionsMeta(signal))
					.location_types;
				return Object.hasOwn(types, type) ? types[type]?.label || undefined : undefined;
			}),
		attribution: (dataset, signal) =>
			guarded(
				signal,
				async () =>
					(await catalog(signal)).datasets.find((d) => d.id === dataset)?.source || undefined
			)
	};
}
