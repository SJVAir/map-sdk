import type { FeatureCollection, Point } from "geojson";
import {
	getMonitors,
	getMonitorsList,
	getMonitorsMeta,
	type MonitorData,
	type MonitorEntryType,
	type MonitorLatest,
	type MonitorsMeta
} from "@sjvair/sdk";
import { encodeRef } from "../data/refs.js";
import type { ScaleRef } from "../data/scale-types.js";
import type { DataSource, DataStatus, MonitorFeatureProperties } from "../data/types.js";
import { anySignal, untilAborted, type SignalOptions } from "./abort.js";

// Ported from monitor-map's `monitorsManager` (src/lib/monitors/monitors.svelte.ts): the same
// init, update, polling, and cancelling rules, as a factory with entry types as plain strings.

/** A monitor from the monitors list. */
export type MonitorsListItem = MonitorData;

/** A monitor's latest reading for the store's entry type. */
export interface MonitorReading {
	/** Null when the server sent no numeric value. */
	value: number | null;
	/** When the reading was taken (ISO 8601). */
	timestamp: string;
}

export interface MonitorsStoreOptions {
	/** How often polling refreshes the data, in milliseconds. Default 120 000 (2 minutes). */
	pollIntervalMs?: number;
}

export interface MonitorsInitOptions extends SignalOptions {
	/**
	 * Start polling once the initial load finishes. Defaults to true; pass false to load the data
	 * without showing a map (`resumeAutoUpdate()` starts polling later).
	 */
	autoUpdate?: boolean;
	/**
	 * Stops waiting: the returned promise rejects with the signal's reason. The shared run keeps
	 * going for the other calls waiting on it, and is cancelled only when every call waiting on it
	 * passed a signal and all of those aborted. An aborted call's entry type and `autoUpdate` stay
	 * recorded. Ignored once initialized.
	 */
	signal?: AbortSignal;
}

export interface MonitorsStore {
	/** True once the first load finished. */
	readonly initialized: boolean;
	/** The entry type the readings are for, such as "pm25". Null before init. */
	readonly entryType: string | null;
	/** Every monitor, by id, from the monitors list. */
	readonly monitors: ReadonlyMap<string, MonitorsListItem>;
	/** Each monitor's latest reading for `entryType`, by monitor id. */
	readonly latest: ReadonlyMap<string, MonitorReading>;
	/** The entry types the server publishes on the map (monitors meta `available_pollutants`). */
	readonly availableEntryTypes: readonly string[];
	/** The monitors meta from init (the SDK's `MonitorsMeta`), or null before init. Read-only. */
	readonly meta: MonitorsMeta | null;
	/**
	 * Sets the entry type. Once initialized, an entry type the server doesn't list falls back to
	 * its default, and the readings blank at once (so markers never show the previous entry
	 * type's readings) and are fetched again. Before init it is replaced by the entry type init
	 * settles on: pass the entry type to `init` instead.
	 */
	entryTypeFor(next: string): void;
	/**
	 * Loads the monitors, their latest readings, and the meta. Safe to call from several places:
	 * overlapping calls share one run, and a failed run can be retried. An explicit entry type
	 * wins over a call without one, whichever came first; between two explicit values the most
	 * recent wins. An entry type the server doesn't list falls back to its default. Polling
	 * starts when the run finishes unless every call sharing it passed `autoUpdate: false`. A
	 * no-op once initialized, so it never restarts polling either: that is `resumeAutoUpdate()`.
	 */
	init(entryType?: string, options?: MonitorsInitOptions): Promise<void>;
	/**
	 * Refreshes the list and the latest readings. Starting an update aborts the previous
	 * in-flight one, which then resolves without touching state. Pass `signal` to cancel from
	 * the outside: that rejects with the signal's reason. A no-op before init.
	 */
	update(options?: SignalOptions): Promise<void>;
	/** Stops polling (for example when the last map showing the data goes away). */
	pauseAutoUpdate(): void;
	/**
	 * Starts polling when it is not running: after `pauseAutoUpdate()` or after an init that
	 * opted out of it. Refreshes first since the data may be stale. A no-op before init or while
	 * polling.
	 */
	resumeAutoUpdate(): void;
	/** The monitors and their readings for `monitorsPlugin`, with the entry type's scale. */
	readonly dataSource: DataSource<MonitorFeatureProperties>;
	/** Stops polling and cancels in-flight requests. A disposed store does nothing. */
	dispose(): void;
}

const DEFAULT_POLL_INTERVAL_MS = 120_000;
const AIR_QUALITY = "air-quality";

/** One shared init run and the calls waiting on it. */
interface InitRun {
	promise: Promise<void>;
	controller: AbortController;
	/** Calls waiting with a signal, and how many of those aborted. */
	signalled: number;
	aborted: number;
	/** Whether any call waits without a signal, which keeps the run going. */
	unsignalled: boolean;
}

type Readings = MonitorLatest[];
type Collection = FeatureCollection<Point, MonitorFeatureProperties>;

/** Every monitor with its latest reading for `entryType`. */
async function getReadings(entryType: string, signal: AbortSignal): Promise<Readings> {
	// The SDK types entry types as a closed union; the server decides which exist.
	const monitors = await getMonitors(entryType as MonitorEntryType, undefined, { signal });
	return monitors as MonitorLatest[];
}

/** The reading's numeric value, or null. */
function readingValue(monitor: MonitorLatest): number | null {
	const raw = "value" in monitor.latest ? monitor.latest.value : null;
	if (raw === null || raw === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

function toCollection(readings: Readings): Collection {
	const features: Collection["features"] = [];
	for (const monitor of readings) {
		if (!monitor.position) continue;
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: monitor.position.coordinates },
			properties: {
				refKey: encodeRef({ kind: "monitor", id: monitor.id }),
				name: monitor.name,
				value: readingValue(monitor),
				type: monitor.type,
				isActive: monitor.is_active,
				isSjvair: monitor.is_sjvair,
				location: monitor.location === "inside" ? "inside" : "outside",
				timestamp: monitor.latest.timestamp
			}
		});
	}
	return { type: "FeatureCollection", features };
}

class LiveMonitorsStore implements MonitorsStore {
	#meta = $state.raw<MonitorsMeta | null>(null);
	#status = $state.raw<DataStatus>({ state: "loading" });

	initialized = $state(false);
	entryType = $state<string | null>(null);
	monitors = $state.raw<ReadonlyMap<string, MonitorsListItem>>(new Map());
	availableEntryTypes = $derived<readonly string[]>(this.#meta?.available_pollutants ?? []);

	get meta(): MonitorsMeta | null {
		return this.#meta;
	}

	latest = $state.raw<ReadonlyMap<string, MonitorReading>>(new Map());

	readonly dataSource: DataSource<MonitorFeatureProperties>;

	/** Null before init; built when the readings arrive, so every reader shares one object. */
	#features = $state.raw<Collection | null>(null);
	/** True before init and while an entry type change refetches (the markers blank). */
	#blank = true;
	#scale = $derived<ScaleRef | null>(
		this.entryType === null ? null : { dataset: AIR_QUALITY, entryType: this.entryType }
	);

	readonly #pollIntervalMs: number;
	#pollTimer: ReturnType<typeof setInterval> | null = null;
	#initRun: InitRun | null = null;
	#requestedEntryType: string | null = null;
	#requestedAutoUpdate = false;
	#updateController: AbortController | null = null;
	#disposed = false;

	constructor(options: MonitorsStoreOptions) {
		this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		// eslint-disable-next-line @typescript-eslint/no-this-alias -- getters below read the store
		const store = this;
		this.dataSource = {
			get status() {
				return store.#status;
			},
			get features() {
				return store.#features;
			},
			get scale() {
				return store.#scale;
			}
		};
	}

	entryTypeFor(next: string): void {
		const meta = this.#meta;
		if (this.initialized && meta && !meta.available_pollutants.includes(next)) {
			next = meta.default_pollutant;
		}
		if (next === this.entryType) return;
		this.entryType = next;
		if (!this.initialized || this.#disposed) return;
		this.#setReadings([]);
		this.#blank = true;
		this.#status = { state: "loading" };
		this.#refresh();
	}

	init(entryType?: string, options: MonitorsInitOptions = {}): Promise<void> {
		if (this.initialized || this.#disposed) return Promise.resolve();

		const { signal } = options;
		// Nothing is recorded or started for a call that is already cancelled.
		if (signal?.aborted) return Promise.reject(signal.reason);

		if (options.autoUpdate !== false) this.#requestedAutoUpdate = true;
		if (entryType) this.#requestedEntryType = entryType;

		const run = (this.#initRun ??= this.#startInitRun());

		if (!signal) {
			run.unsignalled = true;
			return run.promise;
		}

		run.signalled++;
		const onAbort = () => {
			run.aborted++;
			if (!run.unsignalled && run.aborted === run.signalled) this.#abortInitRun(run);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		run.promise.then(cleanup, cleanup);

		return untilAborted(run.promise, signal);
	}

	#startInitRun(): InitRun {
		const controller = new AbortController();
		if (this.#status.state !== "loading") this.#status = { state: "loading" };
		const run: InitRun = {
			// Cancelling rejects at once, even while a request that ignores the signal is pending.
			promise: untilAborted(this.#runInit(controller.signal), controller.signal).then(
				() => {
					if (this.#initRun === run) this.#clearInitRun();
				},
				(error: unknown) => {
					// Recorded before clearing, so retry() repeats the failed call.
					const entryType = this.#requestedEntryType ?? undefined;
					const autoUpdate = this.#requestedAutoUpdate;
					if (this.#initRun === run) this.#clearInitRun();
					if (!controller.signal.aborted) {
						this.#status = {
							state: "error",
							error,
							retry: () => {
								this.init(entryType, { autoUpdate }).catch(() => {});
							}
						};
					}
					throw error;
				}
			),
			controller,
			signalled: 0,
			aborted: 0,
			unsignalled: false
		};
		return run;
	}

	/**
	 * Cancels a run nobody is waiting on. It is detached at once, so a call arriving before its
	 * rejection settles starts a fresh run instead of joining the cancelled one.
	 */
	#abortInitRun(run: InitRun): void {
		if (this.#initRun !== run) return;
		this.#clearInitRun();
		run.controller.abort();
	}

	#clearInitRun(): void {
		this.#initRun = null;
		this.#requestedEntryType = null;
		this.#requestedAutoUpdate = false;
	}

	/** The requested entry type when the server lists it, else the server's default. */
	#wantedEntryType(meta: MonitorsMeta): string {
		const requested = this.#requestedEntryType;
		return requested && meta.available_pollutants.includes(requested)
			? requested
			: meta.default_pollutant;
	}

	async #runInit(signal: AbortSignal): Promise<void> {
		// The entry type the latest readings were requested for.
		let fetchedEntryType = this.#requestedEntryType;

		const metaRequest = getMonitorsMeta({ signal });
		const listAndMeta = Promise.all([getMonitorsList({ signal }), metaRequest]).then(
			([list, meta]) => {
				if (signal.aborted) throw signal.reason;
				this.monitors = new Map(list.map((monitor) => [monitor.id, monitor]));
				this.#meta = meta;
				return meta;
			}
		);
		// The latest readings only need the entry type, so they never wait for the list. An
		// explicit entry type may still arrive before meta does, in which case the default is never
		// fetched. An explicit one is requested before meta can say whether the server lists it; if
		// it doesn't, its failure is dropped and the default is fetched below.
		const latestRequest: Promise<Readings | null> = fetchedEntryType
			? getReadings(fetchedEntryType, signal).catch(async (error: unknown) => {
					const meta = await metaRequest;
					if (this.#wantedEntryType(meta) === fetchedEntryType || signal.aborted) throw error;
					// Nothing was fetched: if this entry type is wanted again, it is fetched again.
					fetchedEntryType = null;
					return null;
				})
			: metaRequest.then((meta) => {
					const entryType = this.#wantedEntryType(meta);
					fetchedEntryType = entryType;
					return getReadings(entryType, signal);
				});

		// One Promise.all so a failure in either never leaves the other unhandled.
		const [meta, firstReadings] = await Promise.all([listAndMeta, latestRequest]);
		let readings = firstReadings;

		// An explicit entry type may have arrived while the requests above were in flight.
		let wanted = this.#wantedEntryType(meta);
		while (wanted !== fetchedEntryType) {
			readings = await getReadings(wanted, signal);
			fetchedEntryType = wanted;
			wanted = this.#wantedEntryType(meta);
		}

		// Cancelled while a request that ignores the signal was settling: leave state to the next run.
		if (signal.aborted) throw signal.reason;

		this.entryType = fetchedEntryType;
		// Non-null: the loop above leaves the readings of the entry type it settled on.
		this.#setReadings(readings!);
		this.#status = { state: "ready" };
		if (this.#requestedAutoUpdate) this.#startPolling();
		this.initialized = true;
	}

	#setReadings(readings: Readings): void {
		this.latest = new Map(
			readings.map((monitor) => [
				monitor.id,
				{ value: readingValue(monitor), timestamp: monitor.latest.timestamp }
			])
		);
		this.#features = toCollection(readings);
		this.#blank = false;
	}

	#startPolling(): void {
		if (this.#pollTimer !== null) return;
		this.#pollTimer = setInterval(() => this.#refresh(), this.#pollIntervalMs);
	}

	pauseAutoUpdate(): void {
		if (this.#pollTimer === null) return;
		clearInterval(this.#pollTimer);
		this.#pollTimer = null;
	}

	resumeAutoUpdate(): void {
		if (!this.initialized || this.#disposed || this.#pollTimer !== null) return;

		this.#refresh();
		this.#startPolling();
	}

	/** An update nobody awaits: polling, resuming, an entry type change, or a retry. */
	#refresh(): void {
		this.update().catch(console.error);
	}

	async update(options: SignalOptions = {}): Promise<void> {
		// Always set once initialized; the null check only narrows the type.
		const entryType = this.entryType;
		if (!this.initialized || this.#disposed || entryType === null) return;

		// Nothing has started yet, so an in-flight update is left alone.
		if (options.signal?.aborted) throw options.signal.reason;

		const supersededInFlight = this.#updateController !== null;
		this.#updateController?.abort();
		const controller = new AbortController();
		this.#updateController = controller;
		const combined = anySignal(controller.signal, options.signal);

		// The caller cancelled this update. If it is still the latest and it cut off an update that
		// was in flight, that update's data is lost too, so refresh again without a signal.
		const callerAborted = (signal: AbortSignal) => {
			if (supersededInFlight && this.#updateController === controller) this.#refresh();
			return signal.reason;
		};

		// Set once callerAborted has run, so the catch below does not run it a second time.
		let abortedError: unknown;

		try {
			const [list, readings] = await Promise.all([
				getMonitorsList({ signal: combined.signal }),
				getReadings(entryType, combined.signal)
			]);

			// Superseded or cancelled while the requests were settling.
			if (options.signal?.aborted) throw (abortedError = callerAborted(options.signal));
			if (controller.signal.aborted) return;

			// The entry type changed while this was in flight: these readings belong to the previous
			// one, and the change has already started its own update.
			if (this.entryType !== entryType) return;

			this.monitors = new Map(list.map((monitor) => [monitor.id, monitor]));
			this.#setReadings(readings);
			this.#status = { state: "ready" };
		} catch (error) {
			// The caller's own abort rejects with its reason. A superseded update resolves quietly.
			if (options.signal?.aborted)
				throw error === abortedError ? error : callerAborted(options.signal);
			if (controller.signal.aborted) return;
			// With readings still shown, a failed refresh keeps them (polling tries again); with
			// none (after an entry type change), the source reports the failure.
			if (this.#blank) {
				this.#status = {
					state: "error",
					error,
					retry: () => {
						this.#status = { state: "loading" };
						this.#refresh();
					}
				};
			}
			throw error;
		} finally {
			combined.dispose();
			if (this.#updateController === controller) this.#updateController = null;
		}
	}

	dispose(): void {
		this.#disposed = true;
		this.pauseAutoUpdate();
		this.#updateController?.abort();
		if (this.#initRun) this.#abortInitRun(this.#initRun);
	}
}

/**
 * The live monitors data for an app: the monitor list, the latest readings for one entry type,
 * and polling every 2 minutes. One store can feed any number of maps and screens, or none: its
 * `dataSource` goes straight to `monitorsPlugin`. Call `init()` to load, and `dispose()` when the
 * app is done with it.
 */
export function createMonitorsStore(options: MonitorsStoreOptions = {}): MonitorsStore {
	return new LiveMonitorsStore(options);
}
