import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMonitorsStore,
	type MonitorsStore
} from "../../../src/lib/stores/monitors-store.svelte.js";
import { rootEffect } from "../../fixtures/effects.svelte.js";

// Ported from monitor-map's tests/client/monitors-manager-refetch.test.ts. These specs compile
// rune modules for the client, so effects that read the store really run here.

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
const readings = (entryType: string) => [
	{ ...monitor("a"), latest: { entry_type: entryType, value: "5", timestamp: entryType } }
];

const entryTypesRequested = () => sdk.getMonitors.mock.calls.map((call) => call[0]);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let store: MonitorsStore;

beforeEach(() => {
	sdk.getMonitorsList.mockReset().mockResolvedValue(LIST);
	sdk.getMonitorsMeta.mockReset().mockResolvedValue(META);
	sdk.getMonitors.mockReset().mockImplementation(async (entryType: string) => readings(entryType));
	store = createMonitorsStore();
});

afterEach(() => {
	store.dispose();
});

describe("the store's refetch on an entry type change", () => {
	it("does not refetch when init sets the entry type", async () => {
		await store.init("o3");
		flushSync();
		await flush();

		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
		expect(entryTypesRequested()).toEqual(["o3"]);
		expect([...store.monitors.keys()]).toEqual(["a"]);
		expect(store.latest.get("a")).toEqual({ value: 5, timestamp: "o3" });
	});

	it("does not refetch when init replaces an entry type set before it", async () => {
		store.entryTypeFor("pm25");
		flushSync();

		await store.init("o3");
		flushSync();
		await flush();

		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
		expect(entryTypesRequested()).toEqual(["o3"]);
	});

	it("refetches once when the entry type changes after init", async () => {
		await store.init();
		flushSync();
		sdk.getMonitorsList.mockClear();
		sdk.getMonitors.mockClear();

		store.entryTypeFor("o3");
		flushSync();

		// Blanked at once, so markers are never colored with the previous entry type's readings.
		expect(store.latest.size).toBe(0);
		expect(store.dataSource.features?.features).toEqual([]);

		await flush();
		flushSync();
		await flush();

		expect(sdk.getMonitorsList).toHaveBeenCalledTimes(1);
		expect(entryTypesRequested()).toEqual(["o3"]);
		expect(store.latest.get("a")).toEqual({ value: 5, timestamp: "o3" });
	});

	it("does not refetch when the entry type is set to the value it already has", async () => {
		await store.init();
		flushSync();
		sdk.getMonitorsList.mockClear();

		store.entryTypeFor("pm25");
		flushSync();
		await flush();

		expect(sdk.getMonitorsList).not.toHaveBeenCalled();
	});

	it("updates an effect that reads the data source", async () => {
		const seen: string[] = [];
		const stop = rootEffect(() => {
			const { status, features } = store.dataSource;
			seen.push(`${status.state}:${features?.features.length ?? "-"}`);
		});
		flushSync();

		await store.init();
		flushSync();
		store.entryTypeFor("o3");
		flushSync();
		await flush();
		flushSync();
		stop();

		expect(seen).toEqual(["loading:-", "ready:1", "loading:0", "ready:1"]);
	});
});
