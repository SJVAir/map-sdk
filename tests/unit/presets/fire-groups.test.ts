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
});
