import area from "@turf/area";
import { convertArea, polygon } from "@turf/helpers";
import { describe, expect, it } from "vitest";
import { clusterAreaSqMiles, convexHull } from "../../../src/lib/presets/cluster-area.js";

type P = [number, number];

/** The old map's computation: the ring as given, closed, in square miles. */
const ringMiles = (ring: P[]) =>
	convertArea(area(polygon([[...ring, ring[0]]])), "meters", "miles");

describe("clusterAreaSqMiles", () => {
	const tri: P[] = [
		[-119.7, 36.7],
		[-119.6, 36.7],
		[-119.6, 36.8]
	];

	it("3 points: the old map's triangle area", () => {
		expect(clusterAreaSqMiles(tri).toFixed(3)).toBe(ringMiles(tri).toFixed(3));
	});

	it("2 points, one spot, or a line: 0", () => {
		expect(clusterAreaSqMiles(tri.slice(0, 2))).toBe(0);
		expect(clusterAreaSqMiles([tri[0], tri[0], tri[0]])).toBe(0);
		expect(
			clusterAreaSqMiles([
				[-119.7, 36.7],
				[-119.6, 36.7],
				[-119.5, 36.7]
			])
		).toBe(0);
		expect(clusterAreaSqMiles([])).toBe(0);
	});

	it("4+ points: the hull's area, whatever the order", () => {
		const square: P[] = [
			[-119.7, 36.7],
			[-119.6, 36.8],
			[-119.6, 36.7],
			[-119.7, 36.8]
		];
		const inner: P = [-119.65, 36.75];
		const a = clusterAreaSqMiles([...square, inner]);
		expect(clusterAreaSqMiles([inner, ...[...square].reverse()])).toBeCloseTo(a, 9);
		const ordered = [square[0], square[2], square[1], square[3]];
		expect(a).toBeCloseTo(ringMiles(ordered), 9);
		// The old leaf-order ring crosses itself and comes out smaller.
		expect(ringMiles(square)).toBeLessThan(a);
	});
});

describe("convexHull", () => {
	it("drops inner and collinear points", () => {
		const hull = convexHull([
			[0, 0],
			[2, 0],
			[1, 0],
			[2, 2],
			[0, 2],
			[1, 1]
		]);
		expect(hull).toHaveLength(4);
		expect(hull).toEqual(
			expect.arrayContaining([
				[0, 0],
				[2, 0],
				[2, 2],
				[0, 2]
			])
		);
	});
});
