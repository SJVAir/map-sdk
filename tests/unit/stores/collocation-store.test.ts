import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeRef } from "../../../src/lib/data/refs.js";
import type { DataSource, MonitorFeatureProperties } from "../../../src/lib/data/types.js";
import { createCollocationSitesStore } from "../../../src/lib/stores/collocation-store.svelte.js";
import type {
	MonitorReading,
	MonitorsListItem,
	MonitorsStore
} from "../../../src/lib/stores/monitors-store.svelte.js";

const sdk = vi.hoisted(() => ({ getCollocationSites: vi.fn() }));
vi.mock("@sjvair/sdk", () => sdk);

const SCALE = { dataset: "air-quality", entryType: "pm25" };

const site = (id: string, reference: string, colocated: string, lng = -119.7) => ({
	id,
	reference_id: reference,
	colocated_id: colocated,
	name: `Site ${id}`,
	position: { type: "Point", coordinates: [lng, 36.7] }
});

const listItem = (id: string, type: string, extra: Partial<MonitorsListItem> = {}) =>
	({
		id,
		name: `Monitor ${id}`,
		type,
		is_active: true,
		is_sjvair: false,
		location: "outside",
		position: { type: "Point", coordinates: [-119, 36] },
		...extra
	}) as unknown as MonitorsListItem;

/** The parts of a monitors store collocations read, with settable maps. */
function fakeMonitors(
	monitors: MonitorsListItem[],
	latest: Record<string, MonitorReading>
): MonitorsStore & {
	monitors: ReadonlyMap<string, MonitorsListItem>;
	latest: ReadonlyMap<string, MonitorReading>;
} {
	const fake = {
		monitors: new Map(monitors.map((m) => [m.id, m])) as ReadonlyMap<string, MonitorsListItem>,
		latest: new Map(Object.entries(latest)) as ReadonlyMap<string, MonitorReading>,
		dataSource: {
			status: { state: "ready" },
			features: null,
			scale: SCALE
		} as DataSource<MonitorFeatureProperties>
	};
	return fake as unknown as ReturnType<typeof fakeMonitors>;
}

afterEach(() => vi.resetAllMocks());

describe("collocation sites store", () => {
	it("joins sites to reference and collocated readings", async () => {
		sdk.getCollocationSites.mockResolvedValue([site("s1", "ref", "col")]);
		const monitors = fakeMonitors(
			[
				listItem("ref", "airnow", { is_sjvair: true }),
				listItem("col", "purpleair", { location: "inside" })
			],
			{
				ref: { value: 12.4, timestamp: "2026-11-04T10:00:00Z" },
				col: { value: 15, timestamp: "2026-11-04T10:02:00Z" }
			}
		);
		const store = createCollocationSitesStore({ monitors });
		expect(store.status).toEqual({ state: "loading" });
		expect(store.dataSource.features).toBeNull();
		await store.init();
		await store.init();
		expect(sdk.getCollocationSites).toHaveBeenCalledTimes(1);
		expect(sdk.getCollocationSites.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
		expect(store.status).toEqual({ state: "ready" });
		expect(store.dataSource.scale).toBe(SCALE);
		const [feature] = store.dataSource.features!.features;
		expect(feature.geometry).toEqual({ type: "Point", coordinates: [-119.7, 36.7] });
		expect(feature.properties).toEqual({
			refKey: encodeRef({ kind: "feature", id: "s1" }),
			name: "Site s1",
			value: 12.4,
			timestamp: "2026-11-04T10:00:00Z",
			type: "airnow",
			isActive: true,
			isSjvair: true,
			location: "outside",
			colocatedId: "col",
			colocatedName: "Monitor col",
			colocatedType: "purpleair",
			colocatedValue: 15,
			colocatedTimestamp: "2026-11-04T10:02:00Z"
		});
		// One object per input, so every reader shares it.
		expect(store.dataSource.features).toBe(store.dataSource.features);
	});

	it("readings follow a monitors store update", async () => {
		sdk.getCollocationSites.mockResolvedValue([site("s1", "ref", "col")]);
		const monitors = fakeMonitors([listItem("ref", "airnow"), listItem("col", "purpleair")], {
			ref: { value: 10, timestamp: "2026-11-04T10:00:00Z" },
			col: { value: 11, timestamp: "2026-11-04T10:00:00Z" }
		});
		const store = createCollocationSitesStore({ monitors });
		await store.init();
		const before = store.dataSource.features;
		monitors.latest = new Map([
			["ref", { value: 40, timestamp: "2026-11-04T10:10:00Z" }],
			["col", { value: 41, timestamp: "2026-11-04T10:12:00Z" }]
		]);
		const after = store.dataSource.features!;
		expect(after).not.toBe(before);
		expect(after.features[0].properties).toMatchObject({
			value: 40,
			timestamp: "2026-11-04T10:10:00Z",
			colocatedValue: 41,
			colocatedTimestamp: "2026-11-04T10:12:00Z"
		});
		monitors.monitors = new Map([["ref", listItem("ref", "airnow", { is_active: false })]]);
		expect(store.dataSource.features!.features[0].properties).toMatchObject({
			isActive: false,
			colocatedName: null,
			colocatedType: null
		});
		expect(sdk.getCollocationSites).toHaveBeenCalledTimes(1);
	});

	it("missing monitor gives a null reading and keeps the site", async () => {
		sdk.getCollocationSites.mockResolvedValue([
			site("s1", "gone", "col", -119.1),
			site("s2", "ref", "gone", -119.2)
		]);
		const monitors = fakeMonitors([listItem("ref", "airnow"), listItem("col", "purpleair")], {
			// A listed monitor without a reading.
			col: { value: 9, timestamp: "2026-11-04T10:00:00Z" }
		});
		const store = createCollocationSitesStore({ monitors });
		await store.init();
		const [first, second] = store.dataSource.features!.features;
		expect(first.geometry).toEqual({ type: "Point", coordinates: [-119.1, 36.7] });
		expect(first.properties).toMatchObject({
			name: "Site s1",
			value: null,
			timestamp: null,
			// Not inactive gray: the neutral color for a missing reading.
			isActive: true,
			colocatedValue: 9
		});
		expect(typeof first.properties.type).toBe("string");
		expect(second.geometry).toEqual({ type: "Point", coordinates: [-119.2, 36.7] });
		expect(second.properties).toMatchObject({
			name: "Site s2",
			type: "airnow",
			value: null,
			timestamp: null,
			colocatedId: "gone",
			colocatedName: null,
			colocatedValue: null,
			colocatedTimestamp: null
		});

		// Before the monitors store loads at all, the sites still draw.
		const empty = createCollocationSitesStore({ monitors: fakeMonitors([], {}) });
		await empty.init();
		expect(empty.dataSource.features!.features).toHaveLength(2);
		expect(empty.dataSource.features!.features.every((f) => f.properties.value === null)).toBe(
			true
		);
	});

	it("load failure gives retry", async () => {
		const failure = new Error("offline");
		sdk.getCollocationSites.mockRejectedValueOnce(failure);
		const store = createCollocationSitesStore({ monitors: fakeMonitors([], {}) });
		await expect(store.init()).rejects.toBe(failure);
		expect(store.status).toMatchObject({ state: "error", error: failure });
		expect(store.dataSource.status).toBe(store.status);
		expect(store.dataSource.features).toBeNull();
		sdk.getCollocationSites.mockResolvedValueOnce([site("s1", "ref", "col")]);
		if (store.status.state !== "error") throw new Error("expected error");
		store.status.retry();
		await vi.waitFor(() => expect(store.status).toEqual({ state: "ready" }));
		expect(store.dataSource.features!.features).toHaveLength(1);
		expect(sdk.getCollocationSites).toHaveBeenCalledTimes(2);
	});

	it("dispose cancels the in-flight request", async () => {
		let signal: AbortSignal | undefined;
		sdk.getCollocationSites.mockImplementation((options: { signal: AbortSignal }) => {
			signal = options.signal;
			return new Promise(() => {});
		});
		const store = createCollocationSitesStore({ monitors: fakeMonitors([], {}) });
		const pending = store.init();
		store.dispose();
		await expect(pending).rejects.toBeDefined();
		expect(signal!.aborted).toBe(true);
	});
});
