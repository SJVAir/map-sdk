import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
	createMonitorsStore,
	type MonitorsStore
} from "../../../src/lib/stores/monitors-store.svelte.js";

// Ported from monitor-map's tests/monitors/monitors-manager.test.ts, adapted to a factory: each
// test creates its own store instead of re-importing a singleton module.

const sdk = vi.hoisted(() => ({
	getMonitors: vi.fn(),
	getMonitorsList: vi.fn(),
	getMonitorsMeta: vi.fn()
}));
vi.mock("@sjvair/sdk", () => sdk);

const monitor = (id: string) => ({
	id,
	name: `Monitor ${id}`,
	type: "purpleair",
	is_active: true,
	is_sjvair: false,
	location: "outside",
	position: { type: "Point", coordinates: [-119.7, 36.8] }
});
const LIST = [monitor("a")];
const META = { default_pollutant: "pm25", available_pollutants: ["o3", "pm25"] };
/** Readings for monitor "a"; the timestamp names the entry type they were requested for. */
const readings = (entryType: string, value = "5") => [
	{ ...monitor("a"), latest: { entry_type: entryType, value, timestamp: entryType } }
];
/** What `store.latest` holds for those readings. */
const reading = (entryType: string, value = 5) => ({ value, timestamp: entryType });

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const entryTypesRequested = () => sdk.getMonitors.mock.calls.map((call) => call[0]);

// Lets every already-resolved promise chain run before the next assertion.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Polling is the store's only interval timer (timeouts stay real for `flush`). */
const polling = () => vi.getTimerCount() > 0;

let store: MonitorsStore;
const stores: MonitorsStore[] = [];
function create(...args: Parameters<typeof createMonitorsStore>): MonitorsStore {
	const created = createMonitorsStore(...args);
	stores.push(created);
	return created;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	sdk.getMonitorsList.mockReset().mockResolvedValue(LIST);
	sdk.getMonitorsMeta.mockReset().mockResolvedValue(META);
	sdk.getMonitors.mockReset().mockImplementation(async (entryType: string) => readings(entryType));
	store = create();
});

afterEach(() => {
	for (const created of stores.splice(0)) created.dispose();
	vi.useRealTimers();
});

describe("store.init", () => {
	it("shares one run between overlapping calls", async () => {
		const first = store.init();
		const second = store.init();

		expect(second).toBe(first);
		await Promise.all([first, second]);

		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
		expect(sdk.getMonitorsMeta).toHaveBeenCalledTimes(1);
		expect(entryTypesRequested()).toEqual(["pm25"]);
		expect(vi.getTimerCount()).toBe(1);
		expect(store.initialized).toBe(true);
		expect([...store.monitors.keys()]).toEqual(["a"]);
		expect(store.monitors.get("a")).toEqual(LIST[0]);
		expect(store.entryType).toBe("pm25");
		expect(store.availableEntryTypes).toEqual(["o3", "pm25"]);
	});

	it("lets an explicit entry type win over an earlier call without one", async () => {
		await Promise.all([store.init(), store.init("o3")]);

		expect(store.entryType).toBe("o3");
		expect(store.latest.get("a")).toEqual(reading("o3"));
		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
		// It arrived before meta did, so the default entry type's readings are never requested.
		expect(entryTypesRequested()).toEqual(["o3"]);
	});

	it("lets an explicit entry type win over a later call without one", async () => {
		await Promise.all([store.init("o3"), store.init()]);

		expect(store.entryType).toBe("o3");
		expect(entryTypesRequested()).toEqual(["o3"]);
	});

	it("uses the most recent of two explicit entry types", async () => {
		await Promise.all([store.init("pm25"), store.init("o3")]);

		expect(store.entryType).toBe("o3");
		expect(store.latest.get("a")).toEqual(reading("o3"));
	});

	it("accepts any entry type the server lists, not only pm25 and o3", async () => {
		sdk.getMonitorsMeta.mockResolvedValue({ ...META, available_pollutants: ["pm25", "no2"] });

		await store.init("no2");

		expect(store.entryType).toBe("no2");
		expect(store.latest.get("a")).toEqual(reading("no2"));
		expect(store.availableEntryTypes).toEqual(["pm25", "no2"]);
	});

	it("refetches once when an explicit entry type arrives mid-run", async () => {
		const list = deferred<typeof LIST>();
		const defaultReadings = deferred<ReturnType<typeof readings>>();
		const explicitReadings = deferred<ReturnType<typeof readings>>();
		sdk.getMonitorsList.mockReturnValue(list.promise);
		sdk.getMonitors
			.mockReturnValueOnce(defaultReadings.promise)
			.mockReturnValueOnce(explicitReadings.promise);

		const run = store.init();
		await flush();
		expect(entryTypesRequested()).toEqual(["pm25"]);

		void store.init("o3");
		list.resolve(LIST);
		defaultReadings.resolve(readings("pm25"));
		await flush();

		expect(entryTypesRequested()).toEqual(["pm25", "o3"]);
		expect(store.initialized).toBe(false);

		explicitReadings.resolve(readings("o3"));
		await run;

		expect(store.initialized).toBe(true);
		expect(store.entryType).toBe("o3");
		expect(store.latest.get("a")).toEqual(reading("o3"));
		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
	});

	it("requests an explicit entry type's readings without waiting for the list", async () => {
		const list = deferred<typeof LIST>();
		sdk.getMonitorsList.mockReturnValue(list.promise);

		const run = store.init("o3");
		expect(entryTypesRequested()).toEqual(["o3"]);

		list.resolve(LIST);
		await run;
	});

	it("requests the default entry type's readings once meta arrives, without the list", async () => {
		const list = deferred<typeof LIST>();
		sdk.getMonitorsList.mockReturnValue(list.promise);

		const run = store.init();
		await flush();
		expect(entryTypesRequested()).toEqual(["pm25"]);
		expect(store.initialized).toBe(false);

		list.resolve(LIST);
		await run;
		expect(store.initialized).toBe(true);
	});

	it.each([undefined, ""])("uses the default entry type for %j", async (value) => {
		await store.init(value);

		expect(store.entryType).toBe("pm25");
		expect(entryTypesRequested()).toEqual(["pm25"]);
	});

	it("falls back to the default for an entry type the server doesn't list", async () => {
		// The readings were requested before meta could say so; the server rejects them.
		sdk.getMonitors.mockImplementation(async (entryType: string) => {
			if (entryType === "none") throw new Error("404");
			return readings(entryType);
		});

		await store.init("none");

		expect(store.entryType).toBe("pm25");
		expect(entryTypesRequested()).toEqual(["none", "pm25"]);
		expect(store.latest.get("a")).toEqual(reading("pm25"));
	});

	it("refetches when an entry type whose failed readings were dropped is requested again", async () => {
		const list = deferred<typeof LIST>();
		const firstPm25 = deferred<ReturnType<typeof readings>>();
		sdk.getMonitorsList.mockReturnValue(list.promise);
		sdk.getMonitors.mockReturnValueOnce(firstPm25.promise);

		const run = store.init("pm25");
		void store.init("o3");
		// o3 is wanted now, so the pm25 failure is dropped.
		firstPm25.reject(new Error("pm25 failed"));
		await flush();
		void store.init("pm25");
		list.resolve(LIST);
		await run;

		expect(entryTypesRequested()).toEqual(["pm25", "pm25"]);
		expect(store.initialized).toBe(true);
		expect(store.entryType).toBe("pm25");
		expect(store.latest.get("a")).toEqual(reading("pm25"));
	});

	it("still fails when the default entry type's readings fail", async () => {
		sdk.getMonitors.mockRejectedValueOnce(new Error("latest failed"));

		await expect(store.init("pm25")).rejects.toThrow("latest failed");
		expect(store.initialized).toBe(false);
	});

	it("can be retried after the list request fails", async () => {
		sdk.getMonitorsList.mockRejectedValueOnce(new Error("offline"));

		await expect(store.init()).rejects.toThrow("offline");
		expect(store.initialized).toBe(false);
		expect(polling()).toBe(false);

		await store.init();
		expect(store.initialized).toBe(true);
		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(1);
	});

	it("can be retried after the latest-readings request fails", async () => {
		sdk.getMonitors.mockRejectedValueOnce(new Error("latest failed"));

		await expect(store.init()).rejects.toThrow("latest failed");
		expect(store.initialized).toBe(false);

		await store.init();
		expect(store.initialized).toBe(true);
	});

	it("rejects once when the list and the latest-readings requests both fail", async () => {
		sdk.getMonitorsList.mockRejectedValueOnce(new Error("list failed"));
		sdk.getMonitors.mockRejectedValueOnce(new Error("latest failed"));

		// Vitest fails the run on an unhandled rejection, so this also pins that neither is left
		// unhandled.
		await expect(store.init("o3")).rejects.toThrow();
		await flush();

		expect(store.initialized).toBe(false);
	});

	it("does not carry a failed run's entry type into the retry", async () => {
		sdk.getMonitorsList.mockRejectedValueOnce(new Error("offline"));

		await expect(store.init("o3")).rejects.toThrow("offline");
		await store.init();

		expect(store.entryType).toBe("pm25");
	});

	it("does nothing once initialized", async () => {
		await store.init();
		sdk.getMonitorsList.mockClear();
		sdk.getMonitorsMeta.mockClear();
		sdk.getMonitors.mockClear();

		await store.init("o3");

		expect(sdk.getMonitorsList).not.toHaveBeenCalled();
		expect(sdk.getMonitorsMeta).not.toHaveBeenCalled();
		expect(sdk.getMonitors).not.toHaveBeenCalled();
		expect(store.entryType).toBe("pm25");
		expect(vi.getTimerCount()).toBe(1);
	});

	it("does not start polling when asked not to", async () => {
		await store.init(undefined, { autoUpdate: false });

		expect(store.initialized).toBe(true);
		expect(polling()).toBe(false);
	});

	it.each([
		["first", [{ autoUpdate: false }, undefined]],
		["second", [undefined, { autoUpdate: false }]]
	] as const)(
		"starts polling when only the %s of two overlapping calls opts out",
		async (_which, [a, b]) => {
			await Promise.all([store.init(undefined, a), store.init(undefined, b)]);

			expect(vi.getTimerCount()).toBe(1);
		}
	);

	it("does not carry a failed run's polling request into the retry", async () => {
		sdk.getMonitorsList.mockRejectedValueOnce(new Error("offline"));

		await expect(store.init()).rejects.toThrow("offline");
		await store.init(undefined, { autoUpdate: false });

		expect(polling()).toBe(false);
	});

	describe("with a signal", () => {
		let consoleError: MockInstance;
		beforeEach(() => {
			consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		});
		afterEach(() => {
			expect(consoleError).not.toHaveBeenCalled();
			consoleError.mockRestore();
		});

		const metaSignal = (): AbortSignal => sdk.getMonitorsMeta.mock.calls[0][0].signal;

		it("one caller aborting leaves a signal-less caller's run intact", async () => {
			const meta = deferred<typeof META>();
			sdk.getMonitorsMeta.mockReturnValueOnce(meta.promise);
			const controller = new AbortController();

			const first = store.init(undefined, { signal: controller.signal });
			const second = store.init();
			const reason = new Error("gone");
			controller.abort(reason);

			await expect(first).rejects.toBe(reason);
			expect(metaSignal().aborted).toBe(false);
			expect(sdk.getMonitorsList.mock.calls[0][0].signal.aborted).toBe(false);

			meta.resolve(META);
			await second;

			expect(sdk.getMonitors.mock.calls[0][2].signal.aborted).toBe(false);
			expect(store.initialized).toBe(true);
			expect(vi.getTimerCount()).toBe(1);
		});

		it("aborts the run when every waiting caller aborts", async () => {
			const meta = deferred<typeof META>();
			sdk.getMonitorsMeta.mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
				signal.addEventListener("abort", () => meta.reject(signal.reason));
				return meta.promise;
			});
			const a = new AbortController();
			const b = new AbortController();

			const first = store.init(undefined, { signal: a.signal });
			const second = store.init("o3", { signal: b.signal });
			const reasonA = new Error("a gone");
			const reasonB = new Error("b gone");
			a.abort(reasonA);
			expect(metaSignal().aborted).toBe(false);
			b.abort(reasonB);

			expect(metaSignal().aborted).toBe(true);
			await expect(first).rejects.toBe(reasonA);
			await expect(second).rejects.toBe(reasonB);
			await flush();
			expect(store.initialized).toBe(false);
			expect(polling()).toBe(false);
			// A cancelled run is not a failure.
			expect(store.dataSource.status.state).toBe("loading");

			await store.init();
			expect(store.initialized).toBe(true);
			expect(store.entryType).toBe("pm25");
			expect(vi.getTimerCount()).toBe(1);
		});

		it("keeps an aborted caller's entry type", async () => {
			const meta = deferred<typeof META>();
			sdk.getMonitorsMeta.mockReturnValueOnce(meta.promise);
			const controller = new AbortController();

			const first = store.init("o3", { signal: controller.signal });
			const second = store.init(undefined, { autoUpdate: false });
			controller.abort(new Error("gone"));
			await expect(first).rejects.toThrow("gone");

			meta.resolve(META);
			await second;

			expect(store.entryType).toBe("o3");
			// Its polling request stays recorded too.
			expect(vi.getTimerCount()).toBe(1);
		});

		it("starts a fresh run for a call right after every caller aborted", async () => {
			const meta = deferred<typeof META>();
			sdk.getMonitorsMeta.mockReturnValueOnce(meta.promise);
			const controller = new AbortController();

			const first = store.init("o3", { signal: controller.signal });
			controller.abort(new Error("gone"));
			const second = store.init();
			await expect(first).rejects.toThrow("gone");
			await second;

			expect(sdk.getMonitorsMeta).toHaveBeenCalledTimes(2);
			expect(store.initialized).toBe(true);
			expect(store.entryType).toBe("pm25");
			expect(vi.getTimerCount()).toBe(1);

			// The aborted run never lands, even if its request resolves late.
			meta.resolve(META);
			await flush();
			expect(store.entryType).toBe("pm25");
			expect(vi.getTimerCount()).toBe(1);
		});

		it("rejects an already-aborted signal without starting a run", async () => {
			const reason = new Error("gone");

			await expect(store.init(undefined, { signal: AbortSignal.abort(reason) })).rejects.toBe(
				reason
			);

			expect(sdk.getMonitorsList).not.toHaveBeenCalled();
			expect(sdk.getMonitorsMeta).not.toHaveBeenCalled();
			expect(sdk.getMonitors).not.toHaveBeenCalled();
			expect(store.initialized).toBe(false);
		});

		it("resolves once initialized, even with an aborted signal", async () => {
			await store.init();

			await expect(
				store.init(undefined, { signal: AbortSignal.abort(new Error("gone")) })
			).resolves.toBeUndefined();
		});
	});
});

describe("store.resumeAutoUpdate", () => {
	it("does nothing before initialization", () => {
		store.resumeAutoUpdate();

		expect(sdk.getMonitorsList).not.toHaveBeenCalled();
		expect(polling()).toBe(false);
	});

	it("does not refetch while polling is already active", async () => {
		await store.init();
		sdk.getMonitorsList.mockClear();
		sdk.getMonitors.mockClear();

		store.resumeAutoUpdate();
		await flush();

		expect(sdk.getMonitorsList).not.toHaveBeenCalled();
		expect(sdk.getMonitors).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);
	});

	it("refreshes once and starts polling after an init that opted out", async () => {
		await store.init(undefined, { autoUpdate: false });
		sdk.getMonitorsList.mockClear();
		sdk.getMonitors.mockClear();

		store.resumeAutoUpdate();
		await flush();

		expect(sdk.getMonitorsList.mock.calls).toEqual([[{ signal: expect.any(AbortSignal) }]]);
		expect(sdk.getMonitors.mock.calls).toEqual([
			["pm25", undefined, { signal: expect.any(AbortSignal) }]
		]);
		expect(polling()).toBe(true);
	});

	it("refreshes once and restarts polling after it was paused", async () => {
		await store.init("o3");
		store.pauseAutoUpdate();
		expect(polling()).toBe(false);
		sdk.getMonitorsList.mockClear();
		sdk.getMonitors.mockClear();

		store.resumeAutoUpdate();
		await flush();

		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
		expect(entryTypesRequested()).toEqual(["o3"]);
		expect(polling()).toBe(true);
	});
});

describe("polling", () => {
	it("refreshes every two minutes by default, with no map anywhere", async () => {
		await store.init();
		sdk.getMonitorsList.mockClear();
		sdk.getMonitors.mockClear();
		sdk.getMonitors.mockImplementation(async (entryType: string) => readings(entryType, "7"));

		await vi.advanceTimersByTimeAsync(119_999);
		expect(sdk.getMonitorsList).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await flush();
		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
		expect(store.latest.get("a")).toEqual(reading("pm25", 7));
	});

	it("uses pollIntervalMs", async () => {
		const quick = create({ pollIntervalMs: 1_000 });
		await quick.init();
		sdk.getMonitorsList.mockClear();

		await vi.advanceTimersByTimeAsync(1_000);
		await flush();

		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
	});

	it("does not poll after init(…, { autoUpdate: false })", async () => {
		await store.init("pm25", { autoUpdate: false });
		sdk.getMonitorsList.mockClear();

		await vi.advanceTimersByTimeAsync(10 * 120_000);

		expect(sdk.getMonitorsList).not.toHaveBeenCalled();
	});

	it("stops when paused", async () => {
		await store.init();
		store.pauseAutoUpdate();
		sdk.getMonitorsList.mockClear();

		await vi.advanceTimersByTimeAsync(10 * 120_000);

		expect(sdk.getMonitorsList).not.toHaveBeenCalled();
	});
});

describe("store.update", () => {
	it("drops a response for an entry type that is no longer selected", async () => {
		await store.init();
		const stale = deferred<ReturnType<typeof readings>>();
		const fresh = deferred<ReturnType<typeof readings>>();
		sdk.getMonitors.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

		const update = store.update();
		store.entryTypeFor("o3");
		stale.resolve(readings("pm25"));
		await update;

		expect(store.latest.size).toBe(0);

		fresh.resolve(readings("o3"));
		await flush();
		expect(store.latest.get("a")).toEqual(reading("o3"));
	});

	it("applies a response for the entry type that is still selected", async () => {
		await store.init();
		sdk.getMonitorsList.mockResolvedValue([monitor("a"), monitor("b")]);

		await store.update();

		expect([...store.monitors.keys()]).toEqual(["a", "b"]);
		expect(store.latest.get("a")).toEqual(reading("pm25"));
	});

	it("does nothing before init", async () => {
		await store.update();

		expect(sdk.getMonitorsList).not.toHaveBeenCalled();
		expect(sdk.getMonitors).not.toHaveBeenCalled();
	});

	it("aborts an in-flight update when another starts, and the first resolves quietly", async () => {
		await store.init();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const first = deferred<ReturnType<typeof readings>>();
		sdk.getMonitors.mockReturnValueOnce(first.promise);
		sdk.getMonitors.mockClear();
		sdk.getMonitorsList.mockClear();

		const firstUpdate = store.update();
		const firstSignal = sdk.getMonitors.mock.calls[0][2].signal as AbortSignal;
		expect(firstSignal.aborted).toBe(false);

		const secondUpdate = store.update();
		expect(firstSignal.aborted).toBe(true);
		first.reject(firstSignal.reason);
		await expect(firstUpdate).resolves.toBeUndefined();
		await secondUpdate;

		expect(consoleError).not.toHaveBeenCalled();
		expect(store.latest.get("a")).toEqual(reading("pm25"));
		consoleError.mockRestore();
	});

	it("applies only the last of three rapid updates", async () => {
		await store.init();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const results = [1, 2, 3].map(() => deferred<ReturnType<typeof readings>>());
		results.forEach((result) => sdk.getMonitors.mockReturnValueOnce(result.promise));

		const updates = results.map(() => store.update());
		// Out of order on purpose: the superseded ones settle late, even with stale data.
		results[2].resolve(readings("pm25", "3"));
		results[0].resolve(readings("pm25", "1"));
		results[1].resolve(readings("pm25", "2"));
		await expect(Promise.all(updates)).resolves.toEqual([undefined, undefined, undefined]);

		expect(store.latest.get("a")).toEqual(reading("pm25", 3));
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("rejects with the caller's reason when the caller aborts", async () => {
		await store.init();
		const pending = deferred<ReturnType<typeof readings>>();
		sdk.getMonitors.mockReturnValueOnce(pending.promise);
		const before = store.latest;
		const controller = new AbortController();

		const update = store.update({ signal: controller.signal });
		const reason = new Error("navigated away");
		controller.abort(reason);
		pending.reject(reason);

		await expect(update).rejects.toBe(reason);
		expect(store.latest).toBe(before);
	});

	it("rejects immediately for an already-aborted signal", async () => {
		await store.init();
		sdk.getMonitors.mockClear();
		const reason = new Error("already gone");
		const controller = new AbortController();
		controller.abort(reason);
		// A real SDK rejects an aborted request; the mock mimics that.
		sdk.getMonitors.mockImplementationOnce(async (_p, _o, requestOptions) => {
			throw requestOptions.signal.reason;
		});

		await expect(store.update({ signal: controller.signal })).rejects.toBe(reason);
		for (const call of sdk.getMonitors.mock.calls) expect(call[2].signal.aborted).toBe(true);
		expect(entryTypesRequested()).toEqual([]);
	});

	it("does not abort an in-flight update when given an already-aborted signal", async () => {
		await store.init();
		const inFlight = deferred<ReturnType<typeof readings>>();
		sdk.getMonitors.mockReturnValueOnce(inFlight.promise);
		const first = store.update();
		const reason = new Error("already gone");
		const aborted = new AbortController();
		aborted.abort(reason);

		await expect(store.update({ signal: aborted.signal })).rejects.toBe(reason);
		inFlight.resolve(readings("pm25", "1"));
		await first;

		expect(store.latest.get("a")).toEqual(reading("pm25", 1));
	});

	describe("when the caller aborts", () => {
		let consoleError: MockInstance;
		beforeEach(() => {
			consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		});
		afterEach(() => consoleError.mockRestore());

		it("refreshes again if it cut off an in-flight update", async () => {
			await store.init();
			sdk.getMonitors.mockClear();
			const signalless = deferred<ReturnType<typeof readings>>();
			const callers = deferred<ReturnType<typeof readings>>();
			const replacement = deferred<ReturnType<typeof readings>>();
			sdk.getMonitors
				.mockReturnValueOnce(signalless.promise)
				.mockReturnValueOnce(callers.promise)
				.mockReturnValueOnce(replacement.promise);
			const controller = new AbortController();

			const first = store.update();
			const second = store.update({ signal: controller.signal });
			const reason = new Error("gone");
			controller.abort(reason);
			signalless.resolve(readings("pm25"));
			callers.reject(reason);

			await expect(second).rejects.toBe(reason);
			await first;
			expect(entryTypesRequested()).toEqual(["pm25", "pm25", "pm25"]);

			replacement.resolve(readings("pm25", "9"));
			await flush();
			expect(store.latest.get("a")).toEqual(reading("pm25", 9));
			expect(consoleError).not.toHaveBeenCalled();
		});

		it("does not refresh again when nothing was cut off", async () => {
			await store.init();
			sdk.getMonitors.mockClear();
			const pending = deferred<ReturnType<typeof readings>>();
			sdk.getMonitors.mockReturnValueOnce(pending.promise);
			const controller = new AbortController();

			const update = store.update({ signal: controller.signal });
			const reason = new Error("gone");
			controller.abort(reason);
			pending.reject(reason);

			await expect(update).rejects.toBe(reason);
			await flush();
			expect(entryTypesRequested()).toEqual(["pm25"]);
		});

		it("does not refresh again when a newer update already started", async () => {
			await store.init();
			sdk.getMonitors.mockClear();
			const signalless = deferred<ReturnType<typeof readings>>();
			const callers = deferred<ReturnType<typeof readings>>();
			sdk.getMonitors.mockReturnValueOnce(signalless.promise).mockReturnValueOnce(callers.promise);
			const controller = new AbortController();

			const first = store.update();
			const second = store.update({ signal: controller.signal });
			const third = store.update();
			const reason = new Error("gone");
			controller.abort(reason);
			callers.reject(reason);
			signalless.resolve(readings("pm25"));

			await expect(second).rejects.toBe(reason);
			await Promise.all([first, third]);
			expect(entryTypesRequested()).toEqual(["pm25", "pm25", "pm25"]);
			expect(store.latest.get("a")).toEqual(reading("pm25"));
		});
	});

	it("still rejects an ordinary failure when a live signal is passed", async () => {
		await store.init();
		const failure = new Error("500");
		sdk.getMonitors.mockRejectedValueOnce(failure);
		const controller = new AbortController();

		await expect(store.update({ signal: controller.signal })).rejects.toBe(failure);
	});
});

describe("store.entryTypeFor", () => {
	it("blanks the readings and refetches once initialized", async () => {
		await store.init();
		sdk.getMonitorsList.mockClear();
		sdk.getMonitors.mockClear();

		store.entryTypeFor("o3");

		// Blanked at once, so markers are never colored with the previous entry type's readings.
		expect(store.entryType).toBe("o3");
		expect(store.latest.size).toBe(0);
		expect(store.dataSource.features?.features).toEqual([]);
		expect(store.dataSource.status.state).toBe("loading");
		expect(store.dataSource.scale).toEqual({ dataset: "air-quality", entryType: "o3" });

		await flush();
		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
		expect(entryTypesRequested()).toEqual(["o3"]);
		expect(store.latest.get("a")).toEqual(reading("o3"));
		expect(store.dataSource.status.state).toBe("ready");
	});

	it("does nothing for the entry type it already has", async () => {
		await store.init();
		sdk.getMonitorsList.mockClear();

		store.entryTypeFor("pm25");
		await flush();

		expect(sdk.getMonitorsList).not.toHaveBeenCalled();
		expect(store.latest.size).toBe(1);
	});

	it("falls back to the server's default for an entry type it doesn't list", async () => {
		await store.init("o3");
		sdk.getMonitors.mockClear();

		store.entryTypeFor("none");

		expect(store.entryType).toBe("pm25");
		await flush();
		expect(entryTypesRequested()).toEqual(["pm25"]);
		expect(store.latest.get("a")).toEqual(reading("pm25"));
	});

	it("does nothing for an unlisted entry type while on the default", async () => {
		await store.init();
		sdk.getMonitors.mockClear();

		store.entryTypeFor("none");
		await flush();

		expect(store.entryType).toBe("pm25");
		expect(sdk.getMonitors).not.toHaveBeenCalled();
		expect(store.latest.size).toBe(1);
	});

	it("does not fetch before init, and init's entry type replaces it", async () => {
		store.entryTypeFor("o3");
		await flush();
		expect(sdk.getMonitors).not.toHaveBeenCalled();

		await store.init("pm25");

		expect(store.entryType).toBe("pm25");
		expect(entryTypesRequested()).toEqual(["pm25"]);
	});
});

describe("store.dataSource", () => {
	it("has features shaped for monitorsPlugin, with the entry type's scale", async () => {
		sdk.getMonitors.mockResolvedValueOnce([
			{ ...monitor("a"), latest: { entry_type: "pm25", value: "12.5", timestamp: "t1" } },
			{
				...monitor("b"),
				type: "airnow",
				is_active: false,
				is_sjvair: true,
				location: "inside",
				latest: { entry_type: "pm25", value: "", timestamp: "t2" }
			},
			{ ...monitor("c"), position: null, latest: { entry_type: "pm25", value: "1", timestamp: "" } }
		]);

		await store.init();

		expect(store.dataSource.scale).toEqual({ dataset: "air-quality", entryType: "pm25" });
		expect(store.dataSource.features).toEqual({
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: { type: "Point", coordinates: [-119.7, 36.8] },
					properties: {
						refKey: "monitor:a",
						name: "Monitor a",
						value: 12.5,
						type: "purpleair",
						isActive: true,
						isSjvair: false,
						location: "outside",
						timestamp: "t1"
					}
				},
				{
					type: "Feature",
					geometry: { type: "Point", coordinates: [-119.7, 36.8] },
					properties: {
						refKey: "monitor:b",
						name: "Monitor b",
						value: null,
						type: "airnow",
						isActive: false,
						isSjvair: true,
						location: "inside",
						timestamp: "t2"
					}
				}
			]
		});
		expect(store.latest.get("b")).toEqual({ value: null, timestamp: "t2" });
	});

	it("has no features or scale before init", () => {
		expect(store.dataSource.features).toBeNull();
		expect(store.dataSource.scale).toBeNull();
	});

	it("goes loading → ready", async () => {
		expect(store.dataSource.status).toEqual({ state: "loading" });
		const run = store.init();
		expect(store.dataSource.status).toEqual({ state: "loading" });
		await run;
		expect(store.dataSource.status).toEqual({ state: "ready" });
	});

	it("reports a failed init as an error whose retry() loads again", async () => {
		const failure = new Error("offline");
		sdk.getMonitorsList.mockRejectedValueOnce(failure);

		await expect(store.init("o3", { autoUpdate: false })).rejects.toBe(failure);

		const status = store.dataSource.status;
		expect(status).toMatchObject({ state: "error", error: failure });
		if (status.state !== "error") throw new Error("expected an error");

		status.retry();
		expect(store.dataSource.status).toEqual({ state: "loading" });
		await flush();

		expect(store.dataSource.status).toEqual({ state: "ready" });
		expect(store.initialized).toBe(true);
		// The retry repeats the failed call.
		expect(store.entryType).toBe("o3");
		expect(polling()).toBe(false);
	});

	it("reports a failed refetch after an entry type change, and retry() refetches", async () => {
		await store.init();
		const failure = new Error("offline");
		sdk.getMonitors.mockRejectedValueOnce(failure);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		store.entryTypeFor("o3");
		await flush();

		const status = store.dataSource.status;
		expect(status).toMatchObject({ state: "error", error: failure });
		if (status.state !== "error") throw new Error("expected an error");
		status.retry();
		expect(store.dataSource.status).toEqual({ state: "loading" });
		await flush();

		expect(store.dataSource.status).toEqual({ state: "ready" });
		expect(store.latest.get("a")).toEqual(reading("o3"));
		consoleError.mockRestore();
	});

	it("stays ready with the last readings when a poll fails", async () => {
		await store.init();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		sdk.getMonitorsList.mockRejectedValueOnce(new Error("offline"));

		await vi.advanceTimersByTimeAsync(120_000);
		await flush();

		expect(store.dataSource.status).toEqual({ state: "ready" });
		expect(store.latest.get("a")).toEqual(reading("pm25"));
		expect(consoleError).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
	});
});

describe("store.dispose", () => {
	it("stops polling", async () => {
		await store.init();
		expect(polling()).toBe(true);

		store.dispose();

		expect(polling()).toBe(false);
	});

	it("aborts an in-flight update, which resolves quietly", async () => {
		await store.init();
		const pending = deferred<ReturnType<typeof readings>>();
		sdk.getMonitors.mockReturnValueOnce(pending.promise);
		const before = store.latest;

		const update = store.update();
		const signal = sdk.getMonitors.mock.lastCall![2].signal as AbortSignal;
		store.dispose();

		expect(signal.aborted).toBe(true);
		pending.reject(signal.reason);
		await expect(update).resolves.toBeUndefined();
		expect(store.latest).toBe(before);
	});

	it("aborts an in-flight init, and never lands its data", async () => {
		const meta = deferred<typeof META>();
		sdk.getMonitorsMeta.mockReturnValueOnce(meta.promise);

		const run = store.init();
		const signal = sdk.getMonitorsMeta.mock.calls[0][0].signal as AbortSignal;
		store.dispose();

		expect(signal.aborted).toBe(true);
		await expect(run).rejects.toBe(signal.reason);
		meta.resolve(META);
		await flush();
		expect(store.initialized).toBe(false);
		expect(polling()).toBe(false);
	});

	it("leaves the store inert", async () => {
		store.dispose();

		await store.init();
		store.resumeAutoUpdate();

		expect(sdk.getMonitorsMeta).not.toHaveBeenCalled();
		expect(store.initialized).toBe(false);
		expect(polling()).toBe(false);
	});
});

describe("two stores", () => {
	it("are independent", async () => {
		const other = create({ pollIntervalMs: 1_000 });
		await Promise.all([store.init(), other.init("o3")]);
		const before = store.latest;
		sdk.getMonitorsList.mockResolvedValue([monitor("a"), monitor("b")]);
		sdk.getMonitors.mockImplementation(async (entryType: string) => readings(entryType, "8"));

		await other.update();
		expect(other.latest.get("a")).toEqual(reading("o3", 8));
		expect(store.latest).toBe(before);
		expect([...store.monitors.keys()]).toEqual(["a"]);

		other.entryTypeFor("pm25");
		expect(store.latest).toBe(before);

		other.dispose();
		expect(vi.getTimerCount()).toBe(1);
		expect(store.initialized).toBe(true);
	});
});
