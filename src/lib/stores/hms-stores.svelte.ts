import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import { getHMSFire, getHMSSmoke } from "@sjvair/sdk";
import { encodeRef } from "../data/refs.js";
import { defaultMessages, type MessageProvider } from "../data/messages.js";
import type { ScaleRef } from "../data/scale-types.js";
import type {
	DataSource,
	DataStatus,
	FireFeatureProperties,
	MapFeatureProperties
} from "../data/types.js";
import { cleanFires, groupFires, type FireDetection } from "../presets/fire-groups.js";
import type { SignalOptions } from "./abort.js";
import { createLoadOnce, type LoadOnce } from "./load-once.svelte.js";

// Today's HMS smoke and fire, loaded once (no polling), as monitor-map 4.3 does.

export interface HmsStoreOptions {
	/** Names features ("Smoke", "Fire detection"). Default: the built-in English messages. */
	messages?: MessageProvider;
}

export interface HmsSmokeStore {
	/** `loading` until loaded, then `ready` (also when today has no plumes) or `error`. */
	readonly status: DataStatus;
	/** Today's plumes for `hmsSmokePlugin`; each feature's `value` is its density key. */
	readonly dataSource: DataSource;
	/**
	 * Loads today's smoke once. Overlapping calls share one run, and a failed run can be
	 * retried. A caller's abort rejects only that caller; the run stops when every caller
	 * aborted. A no-op once loaded.
	 */
	init(options?: SignalOptions): Promise<void>;
	/** Cancels the in-flight request. A disposed store does nothing. */
	dispose(): void;
}

export interface HmsFireStore {
	/** `loading` until loaded, then `ready` (also when today has no fires) or `error`. */
	readonly status: DataStatus;
	/**
	 * Nearby detections merged (`groupFires`), for `hmsFirePlugin`; `value` is the mean FRP and
	 * `count` how many detections it merges.
	 */
	readonly groups: DataSource<FireFeatureProperties>;
	/** Each detection (`cleanFires`), for `hmsFirePlugin`; `value` is its FRP. */
	readonly hotspots: DataSource;
	/** As `HmsSmokeStore.init`. */
	init(options?: SignalOptions): Promise<void>;
	/** Cancels the in-flight request. A disposed store does nothing. */
	dispose(): void;
}

const SMOKE_SCALE: ScaleRef = { dataset: "hms-smoke", entryType: "smoke-density" };
const FIRE_SCALE: ScaleRef = { dataset: "hms-fire", entryType: "fire-frp" };

type Collection<
	G extends Geometry,
	P extends MapFeatureProperties = MapFeatureProperties
> = FeatureCollection<G, P>;

/** A source over a loader's value; `features` stays null until it loads. */
function sourceOf<T, P extends MapFeatureProperties = MapFeatureProperties>(
	loader: LoadOnce<T>,
	scale: ScaleRef,
	pick: (value: T) => Collection<Geometry, P>
): DataSource<P> {
	// Built once per loaded value, so every reader shares one object.
	let cached: { value: T; features: Collection<Geometry, P> } | null = null;
	return {
		get status() {
			return loader.status;
		},
		get features() {
			const value = loader.value;
			if (value === null) return null;
			if (cached?.value !== value) cached = { value, features: pick(value) };
			return cached.features;
		},
		scale
	};
}

export function createHmsSmokeStore(options: HmsStoreOptions = {}): HmsSmokeStore {
	const messages = options.messages ?? defaultMessages;
	const loader = createLoadOnce(async (signal) => {
		const smoke = await getHMSSmoke(undefined, { signal });
		const name = messages("mapsdk_hms_smoke_name");
		const features: Feature<Geometry, MapFeatureProperties>[] = smoke.map((plume) => ({
			type: "Feature",
			geometry: plume.geometry as Geometry,
			properties: {
				refKey: encodeRef({ kind: "feature", id: plume.id }),
				name,
				value: plume.density
			}
		}));
		return { type: "FeatureCollection", features } satisfies Collection<Geometry>;
	});
	return {
		get status() {
			return loader.status;
		},
		dataSource: sourceOf(loader, SMOKE_SCALE, (collection) => collection),
		init: (initOptions) => loader.init(initOptions),
		dispose: () => loader.dispose()
	};
}

interface Fires {
	hotspots: Collection<Point>;
	groups: Collection<Point, FireFeatureProperties>;
}

export function createHmsFireStore(options: HmsStoreOptions = {}): HmsFireStore {
	const messages = options.messages ?? defaultMessages;
	const loader = createLoadOnce<Fires>(async (signal) => {
		const fires = await getHMSFire(undefined, { signal });
		const detections: FireDetection[] = fires.map((fire) => ({
			id: fire.id,
			coordinates: fire.geometry.coordinates as [number, number],
			frp: fire.frp,
			timestamp: fire.timestamp
		}));
		const detection = messages("mapsdk_hms_fire_detection");
		const hotspots: Feature<Point, MapFeatureProperties>[] = cleanFires(detections).map((fire) => ({
			type: "Feature",
			geometry: { type: "Point", coordinates: fire.coordinates },
			properties: {
				refKey: encodeRef({ kind: "feature", id: fire.id }),
				name: detection,
				value: fire.frp
			}
		}));
		// Every group names its count, a group of 1 included ("1 fire detection").
		const groups: Feature<Point, FireFeatureProperties>[] = groupFires(detections).map((group) => ({
			type: "Feature",
			geometry: { type: "Point", coordinates: group.coordinates },
			properties: {
				refKey: encodeRef({ kind: "feature", id: group.id }),
				name: messages("mapsdk_hms_fire_detections", { count: group.count }),
				value: group.avgFrp,
				count: group.count
			}
		}));
		return {
			hotspots: { type: "FeatureCollection", features: hotspots },
			groups: { type: "FeatureCollection", features: groups }
		};
	});
	return {
		get status() {
			return loader.status;
		},
		groups: sourceOf(loader, FIRE_SCALE, (value) => value.groups),
		hotspots: sourceOf(loader, FIRE_SCALE, (value) => value.hotspots),
		init: (initOptions) => loader.init(initOptions),
		dispose: () => loader.dispose()
	};
}
