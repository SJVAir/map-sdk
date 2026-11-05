import type { Feature, FeatureCollection, Point } from "geojson";
import { getCollocationSites, type CollocationSite } from "@sjvair/sdk";
import { encodeRef } from "../data/refs.js";
import type { CollocationFeatureProperties, DataSource, DataStatus } from "../data/types.js";
import type { SignalOptions } from "./abort.js";
import { createLoadOnce } from "./load-once.svelte.js";
import type { MonitorsStore } from "./monitors-store.svelte.js";

// monitor-map 4.3's collocation sites (src/lib/collocation-sites/): the sites load once, and
// each is joined to its reference and collocated monitors' live readings.

export interface CollocationSitesStoreOptions {
	/** The monitors and readings the sites join to; its entry type's scale colors them. */
	monitors: MonitorsStore;
}

export interface CollocationSitesStore {
	/** `loading` until the sites load, then `ready` or `error` (with `retry`). */
	readonly status: DataStatus;
	/**
	 * The sites for `collocationSitesPlugin`, each at its own position. Readings follow the
	 * monitors store's polling; a monitor missing from it gives null readings.
	 */
	readonly dataSource: DataSource<CollocationFeatureProperties>;
	/**
	 * Loads the sites once. Overlapping calls share one run, and a failed run can be retried. A
	 * caller's abort rejects only that caller; the run stops when every caller aborted. A no-op
	 * once loaded. It doesn't load the monitors store: init that too.
	 */
	init(options?: SignalOptions): Promise<void>;
	/** Cancels the in-flight request. A disposed store does nothing. */
	dispose(): void;
}

type Collection = FeatureCollection<Point, CollocationFeatureProperties>;

function join(sites: CollocationSite[], monitors: MonitorsStore): Collection {
	const list = monitors.monitors;
	const latest = monitors.latest;
	const features: Feature<Point, CollocationFeatureProperties>[] = [];
	for (const site of sites) {
		if (!site.position) continue;
		const reference = list.get(site.reference_id);
		const colocated = list.get(site.colocated_id);
		const referenceReading = latest.get(site.reference_id);
		const colocatedReading = latest.get(site.colocated_id);
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: site.position.coordinates },
			properties: {
				refKey: encodeRef({ kind: "feature", id: site.id }),
				name: site.name,
				value: referenceReading?.value ?? null,
				timestamp: referenceReading?.timestamp ?? null,
				// A missing reference monitor draws as a sensor in the neutral color, not inactive gray.
				type: reference?.type ?? "",
				isActive: reference?.is_active ?? true,
				isSjvair: reference?.is_sjvair ?? false,
				location: reference?.location === "inside" ? "inside" : "outside",
				colocatedId: site.colocated_id,
				colocatedName: colocated?.name ?? null,
				colocatedType: colocated?.type ?? null,
				colocatedValue: colocatedReading?.value ?? null,
				colocatedTimestamp: colocatedReading?.timestamp ?? null
			}
		});
	}
	return { type: "FeatureCollection", features };
}

export function createCollocationSitesStore(
	options: CollocationSitesStoreOptions
): CollocationSitesStore {
	const { monitors } = options;
	const loader = createLoadOnce((signal) => getCollocationSites({ signal }));
	// Rebuilt only when an input changes, so every reader shares one object. Reading the inputs
	// in the getter keeps it reactive to the monitors store's state.
	let cached: {
		sites: CollocationSite[];
		list: MonitorsStore["monitors"];
		latest: MonitorsStore["latest"];
		features: Collection;
	} | null = null;
	return {
		get status() {
			return loader.status;
		},
		dataSource: {
			get status() {
				return loader.status;
			},
			get features() {
				const sites = loader.value;
				if (sites === null) return null;
				const list = monitors.monitors;
				const latest = monitors.latest;
				if (cached?.sites !== sites || cached.list !== list || cached.latest !== latest) {
					cached = { sites, list, latest, features: join(sites, monitors) };
				}
				return cached.features;
			},
			get scale() {
				return monitors.dataSource.scale;
			}
		},
		init: (initOptions) => loader.init(initOptions),
		dispose: () => loader.dispose()
	};
}
