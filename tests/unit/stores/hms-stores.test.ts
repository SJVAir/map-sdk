import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRef } from "../../../src/lib/data/refs.js";
import {
	createHmsFireStore,
	createHmsSmokeStore
} from "../../../src/lib/stores/hms-stores.svelte.js";

const sdk = vi.hoisted(() => ({ getHMSSmoke: vi.fn(), getHMSFire: vi.fn() }));
vi.mock("@sjvair/sdk", () => sdk);

const plume = (id: string, density: string) => ({
	id,
	density,
	geometry: {
		type: "MultiPolygon",
		coordinates: [
			[
				[
					[-120, 36],
					[-119, 36],
					[-119, 37],
					[-120, 36]
				]
			]
		]
	}
});
const fire = (
	id: string,
	lng: number,
	lat: number,
	frp: number | null,
	timestamp = "2026-11-04T10:00:00Z"
) => ({
	id,
	frp,
	timestamp,
	geometry: { type: "Point", coordinates: [lng, lat] }
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.resetAllMocks());

describe("smoke store", () => {
	it("loads today's plumes once", async () => {
		sdk.getHMSSmoke.mockResolvedValue([plume("a", "heavy"), plume("b", "light")]);
		const store = createHmsSmokeStore();
		expect(store.status).toEqual({ state: "loading" });
		expect(store.dataSource.features).toBeNull();
		await store.init();
		await store.init();
		expect(sdk.getHMSSmoke).toHaveBeenCalledTimes(1);
		expect(sdk.getHMSSmoke.mock.calls[0][0]).toBeUndefined();
		expect(sdk.getHMSSmoke.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
		expect(store.status).toEqual({ state: "ready" });
		expect(store.dataSource.scale).toEqual({ dataset: "hms-smoke", entryType: "smoke-density" });
		const features = store.dataSource.features!.features;
		expect(features.map((f) => f.properties)).toEqual([
			{ refKey: encodeRef({ kind: "feature", id: "a" }), name: "Smoke", value: "heavy" },
			{ refKey: encodeRef({ kind: "feature", id: "b" }), name: "Smoke", value: "light" }
		]);
		expect(features[0].geometry.type).toBe("MultiPolygon");
		expect(store.dataSource.features).toBe(store.dataSource.features);
	});

	it("uses the messages provider", async () => {
		sdk.getHMSSmoke.mockResolvedValue([plume("a", "heavy")]);
		const store = createHmsSmokeStore({ messages: (key) => `[${key}]` });
		await store.init();
		expect(store.dataSource.features!.features[0].properties.name).toBe("[mapsdk_hms_smoke_name]");
	});

	it("empty day is ready with an empty collection", async () => {
		sdk.getHMSSmoke.mockResolvedValue([]);
		const store = createHmsSmokeStore();
		await store.init();
		expect(store.status).toEqual({ state: "ready" });
		expect(store.dataSource.features).toEqual({ type: "FeatureCollection", features: [] });
		expect(store.dataSource.scale).not.toBeNull();
	});

	it("failed load reports error with retry and retry loads", async () => {
		const failure = new Error("down");
		sdk.getHMSSmoke.mockRejectedValueOnce(failure).mockResolvedValue([plume("a", "light")]);
		const store = createHmsSmokeStore();
		await expect(store.init()).rejects.toBe(failure);
		const status = store.status;
		expect(status.state).toBe("error");
		if (status.state !== "error") return;
		expect(status.error).toBe(failure);
		status.retry();
		expect(store.status).toEqual({ state: "loading" });
		await flush();
		expect(store.status).toEqual({ state: "ready" });
		expect(store.dataSource.features!.features).toHaveLength(1);
	});

	it("concurrent init shares one request", async () => {
		const pending = deferred<unknown[]>();
		sdk.getHMSSmoke.mockReturnValue(pending.promise);
		const store = createHmsSmokeStore();
		const calls = [store.init(), store.init()];
		pending.resolve([plume("a", "light")]);
		await Promise.all(calls);
		expect(sdk.getHMSSmoke).toHaveBeenCalledTimes(1);
	});

	it("an aborting caller rejects alone while another keeps the run", async () => {
		const pending = deferred<unknown[]>();
		sdk.getHMSSmoke.mockReturnValue(pending.promise);
		const store = createHmsSmokeStore();
		const abort = new AbortController();
		const aborted = store.init({ signal: abort.signal });
		const other = store.init();
		abort.abort(new Error("stop"));
		await expect(aborted).rejects.toThrow("stop");
		pending.resolve([plume("a", "light")]);
		await other;
		expect(store.status).toEqual({ state: "ready" });
		expect(sdk.getHMSSmoke).toHaveBeenCalledTimes(1);
	});

	it("cancels the request when its only caller aborts, and a later init starts over", async () => {
		sdk.getHMSSmoke.mockImplementation(() => new Promise(() => {}));
		const store = createHmsSmokeStore();
		const abort = new AbortController();
		const first = store.init({ signal: abort.signal });
		const signal = sdk.getHMSSmoke.mock.calls[0][1].signal as AbortSignal;
		abort.abort(new Error("stop"));
		await expect(first).rejects.toThrow("stop");
		expect(signal.aborted).toBe(true);
		expect(store.status).toEqual({ state: "loading" });
		sdk.getHMSSmoke.mockResolvedValue([]);
		await store.init();
		expect(sdk.getHMSSmoke).toHaveBeenCalledTimes(2);
		expect(store.status).toEqual({ state: "ready" });
	});

	it("dispose aborts in-flight", async () => {
		sdk.getHMSSmoke.mockImplementation(() => new Promise(() => {}));
		const store = createHmsSmokeStore();
		const init = store.init();
		const signal = sdk.getHMSSmoke.mock.calls[0][1].signal as AbortSignal;
		store.dispose();
		expect(signal.aborted).toBe(true);
		await expect(init).rejects.toBeDefined();
		await store.init();
		expect(sdk.getHMSSmoke).toHaveBeenCalledTimes(1);
	});
});

describe("fire store", () => {
	it("gives cleaned hotspots and groups", async () => {
		sdk.getHMSFire.mockResolvedValue([
			fire("a", -119.5, 36.5, 10, "2026-11-04T09:00:00Z"),
			fire("a2", -119.5, 36.5, 30, "2026-11-04T11:00:00Z"),
			fire("b", -119.51, 36.51, 20),
			fire("none", -118, 35, null),
			fire("far", -121, 38, 5)
		]);
		const store = createHmsFireStore();
		await store.init();
		expect(sdk.getHMSFire.mock.calls[0][0]).toBeUndefined();
		expect(store.status).toEqual({ state: "ready" });
		for (const source of [store.groups, store.hotspots]) {
			expect(source.status).toEqual({ state: "ready" });
			expect(source.scale).toEqual({ dataset: "hms-fire", entryType: "fire-frp" });
		}

		const hotspots = store.hotspots.features!.features;
		// The same-coordinates pair keeps the latest; the fire without FRP is dropped.
		expect(hotspots.map((f) => f.properties)).toEqual([
			{ refKey: encodeRef({ kind: "feature", id: "a2" }), name: "Fire detection", value: 30 },
			{ refKey: encodeRef({ kind: "feature", id: "b" }), name: "Fire detection", value: 20 },
			{ refKey: encodeRef({ kind: "feature", id: "far" }), name: "Fire detection", value: 5 }
		]);
		expect(hotspots[0].geometry).toEqual({ type: "Point", coordinates: [-119.5, 36.5] });

		const groups = store.groups.features!.features;
		expect(groups).toHaveLength(2);
		const merged = groups.find((g) => g.properties.value === 25)!;
		expect(merged.properties.name).toBe("2 fire detections");
		expect(merged.properties.count).toBe(2);
		expect(merged.properties.refKey).toMatch(/^feature:/);
		const single = groups.find((g) => g.properties.value === 5)!;
		// A group of 1 is still a group: it names its count.
		expect(single.properties.name).toBe("1 fire detection");
		expect(single.properties.count).toBe(1);
	});

	it("empty day is ready with empty collections", async () => {
		sdk.getHMSFire.mockResolvedValue([]);
		const store = createHmsFireStore();
		await store.init();
		expect(store.status).toEqual({ state: "ready" });
		const empty = { type: "FeatureCollection", features: [] };
		expect(store.groups.features).toEqual(empty);
		expect(store.hotspots.features).toEqual(empty);
		expect(store.groups.scale).not.toBeNull();
	});

	it("failed load reports error with retry on both sources, and retry loads", async () => {
		const failure = new Error("down");
		sdk.getHMSFire.mockRejectedValueOnce(failure).mockResolvedValue([fire("a", -119, 36, 9)]);
		const store = createHmsFireStore();
		await expect(store.init()).rejects.toBe(failure);
		expect(store.groups.status.state).toBe("error");
		expect(store.hotspots.status.state).toBe("error");
		const status = store.status;
		if (status.state !== "error") throw new Error("expected error");
		status.retry();
		await flush();
		expect(store.status).toEqual({ state: "ready" });
		expect(store.hotspots.features!.features).toHaveLength(1);
	});

	it("concurrent init shares one request and dispose aborts it", async () => {
		sdk.getHMSFire.mockImplementation(() => new Promise(() => {}));
		const store = createHmsFireStore();
		const calls = [store.init(), store.init()];
		expect(sdk.getHMSFire).toHaveBeenCalledTimes(1);
		const signal = sdk.getHMSFire.mock.calls[0][1].signal as AbortSignal;
		store.dispose();
		expect(signal.aborted).toBe(true);
		await expect(Promise.all(calls)).rejects.toBeDefined();
	});
});
