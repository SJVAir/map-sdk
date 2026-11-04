import { describe, expect, it } from "vitest";
import { groupFires } from "../../../src/lib/presets/fire-groups.js";

// One degree of latitude is about 111 km.
const KM = 1 / 111;

describe("groupFires", () => {
	it("is empty for no fires", () => {
		expect(groupFires([])).toEqual([]);
	});

	it("merges fires 1 km apart into one group with the mean position and FRP", () => {
		const groups = groupFires([
			{ id: "a", coordinates: [-119, 36], frp: 10 },
			{ id: "b", coordinates: [-119, 36 + KM], frp: 30 }
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].count).toBe(2);
		expect(groups[0].avgFrp).toBe(20);
		expect(groups[0].coordinates[0]).toBeCloseTo(-119, 9);
		expect(groups[0].coordinates[1]).toBeCloseTo(36 + KM / 2, 9);
	});

	it("keeps a fire 10 km away in its own group", () => {
		const groups = groupFires([
			{ id: "a", coordinates: [-119, 36], frp: 10 },
			{ id: "b", coordinates: [-119, 36 + KM], frp: 30 },
			{ id: "c", coordinates: [-119, 36 + 10 * KM], frp: 99 }
		]);
		expect(groups).toHaveLength(2);
		const far = groups.find((g) => g.count === 1)!;
		expect(far.avgFrp).toBe(99);
		expect(far.coordinates).toEqual([-119, 36 + 10 * KM]);
		expect(new Set(groups.map((g) => g.id)).size).toBe(2);
	});

	it("skips fires with a null or non-finite FRP", () => {
		const groups = groupFires([
			{ id: "a", coordinates: [-119, 36], frp: 10 },
			{ id: "b", coordinates: [-119, 36 + KM], frp: null },
			{ id: "c", coordinates: [-119, 36 + 2 * KM], frp: Number.NaN },
			{ id: "d", coordinates: [-119, 36 + 3 * KM], frp: Number.POSITIVE_INFINITY }
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ count: 1, avgFrp: 10, coordinates: [-119, 36] });
		expect(groupFires([{ id: "a", coordinates: [-119, 36], frp: null }])).toEqual([]);
	});

	it("keeps one fire per coordinates, the latest when they have timestamps", () => {
		const groups = groupFires([
			{ id: "a", coordinates: [-119, 36], frp: 10, timestamp: "2026-11-03T10:00:00Z" },
			{ id: "b", coordinates: [-119, 36], frp: 30, timestamp: "2026-11-03T12:00:00Z" },
			{ id: "c", coordinates: [-119, 36], frp: 50, timestamp: "2026-11-03T11:00:00Z" }
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ count: 1, avgFrp: 30 });

		// Without timestamps, the first one listed.
		const untimed = groupFires([
			{ id: "a", coordinates: [-119, 36], frp: 10 },
			{ id: "b", coordinates: [-119, 36], frp: 30 },
			{ id: "c", coordinates: [-119, 36 + KM], frp: 50 }
		]);
		expect(untimed).toHaveLength(1);
		expect(untimed[0]).toMatchObject({ count: 2, avgFrp: 30 });
	});

	it("skips null FRPs before deduping, so a newer null-FRP duplicate hides no reading", () => {
		const groups = groupFires([
			{ id: "a", coordinates: [-119, 36], frp: 10, timestamp: "2026-11-03T10:00:00Z" },
			{ id: "b", coordinates: [-119, 36], frp: null, timestamp: "2026-11-03T12:00:00Z" }
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].avgFrp).toBe(10);
	});
});
