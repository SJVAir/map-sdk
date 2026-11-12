import type { Polygon, Position } from "geojson";
import { describe, expect, it } from "vitest";
import { assertFocusGeometry, worldMask } from "../../../src/lib/presets/focus-geometry.js";

/** Signed area (twice): positive counter-clockwise. */
function signedArea(ring: Position[]): number {
	let sum = 0;
	for (let i = 0; i < ring.length - 1; i++) {
		sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
	}
	return sum;
}

const ccwSquare: Position[] = [
	[0, 0],
	[1, 0],
	[1, 1],
	[0, 1],
	[0, 0]
];
const cwSquare = ccwSquare.toReversed();
const square = (ring: Position[]): Polygon => ({ type: "Polygon", coordinates: [ring] });

describe("assertFocusGeometry", () => {
	it("accepts Polygon, MultiPolygon, Point and null", () => {
		expect(() => assertFocusGeometry(square(ccwSquare))).not.toThrow();
		expect(() =>
			assertFocusGeometry({ type: "MultiPolygon", coordinates: [[ccwSquare]] })
		).not.toThrow();
		expect(() => assertFocusGeometry({ type: "Point", coordinates: [1, 2] })).not.toThrow();
		expect(() => assertFocusGeometry(null)).not.toThrow();
	});

	it("names the type it refuses", () => {
		expect(() =>
			assertFocusGeometry({
				type: "LineString",
				coordinates: [
					[0, 0],
					[1, 1]
				]
			})
		).toThrow("map-sdk: focusAreaPlugin takes a Polygon, MultiPolygon or Point, not LineString");
	});

	it("refuses things that aren't geometries", () => {
		for (const bad of [{}, "x", undefined]) {
			expect(() => assertFocusGeometry(bad)).toThrow("not unknown");
		}
	});

	it("refuses a point without finite coordinates", () => {
		expect(() => assertFocusGeometry({ type: "Point", coordinates: [NaN, 1] })).toThrow(
			"map-sdk: focusAreaPlugin"
		);
	});
});

describe("worldMask", () => {
	it("is the world counter-clockwise with the area clockwise, whatever its winding", () => {
		for (const ring of [ccwSquare, cwSquare]) {
			const mask = worldMask(square(ring));
			expect(mask.type).toBe("Polygon");
			expect(mask.coordinates).toHaveLength(2);
			expect(mask.coordinates[0]).toEqual([
				[-180, -85],
				[180, -85],
				[180, 85],
				[-180, 85],
				[-180, -85]
			]);
			expect(signedArea(mask.coordinates[0])).toBeGreaterThan(0);
			expect(signedArea(mask.coordinates[1])).toBeLessThan(0);
		}
	});

	it("punches out each part of a MultiPolygon", () => {
		const far = ccwSquare.map(([x, y]) => [x + 5, y]);
		const mask = worldMask({ type: "MultiPolygon", coordinates: [[ccwSquare], [far]] });
		expect(mask.coordinates).toHaveLength(3);
	});

	it("keeps an area's own holes washed", () => {
		const outer = ccwSquare.map(([x, y]) => [x * 10, y * 10]);
		const mask = worldMask({ type: "Polygon", coordinates: [outer, cwSquare] });
		expect(mask.coordinates).toHaveLength(2);
	});

	it("skips degenerate rings", () => {
		const mask = worldMask({
			type: "MultiPolygon",
			coordinates: [
				[
					[
						[0, 0],
						[1, 1]
					]
				],
				[ccwSquare]
			]
		});
		expect(mask.coordinates).toHaveLength(2);
	});
});
