import { describe, expect, it } from "vitest";
import type { Geometry, Position } from "geojson";
import {
	containsPoint,
	geometryBbox,
	intersectsBounds,
	shapeAnchor
} from "../../../src/lib/core/shape-view.js";
import { labelPoint } from "../../../src/lib/plugins/shapes.svelte.js";
import { plumeFeature } from "../../fixtures/plume.js";

const V = { west: -121, south: 36, east: -119, north: 38 };
const CENTER: [number, number] = [-120, 37];

/** A closed rectangle ring. */
function rect(west: number, south: number, east: number, north: number): Position[] {
	return [
		[west, south],
		[east, south],
		[east, north],
		[west, north],
		[west, south]
	];
}
const polygon = (...rings: Position[][]): Geometry => ({ type: "Polygon", coordinates: rings });
const shape = (geometry: Geometry, lngLat: [number, number] = [0, 0]) => ({ lngLat, geometry });

const inside = (p: [number, number], b = V) =>
	p[0] >= b.west && p[0] <= b.east && p[1] >= b.south && p[1] <= b.north;

describe("intersectsBounds", () => {
	it("covers the view with its centroid outside", () => {
		const big = polygon(rect(-124, 26, -118, 39));
		expect(intersectsBounds(shape(big, [-121, 32.5]), V)).toBe(true);
	});

	it("fully outside", () => {
		expect(intersectsBounds(shape(polygon(rect(-110, 36, -109, 37))), V)).toBe(false);
	});

	it("partial overlap", () => {
		expect(intersectsBounds(shape(polygon(rect(-122, 35, -120.5, 36.5))), V)).toBe(true);
	});

	it("multipolygon: in view if any part is", () => {
		const some: Geometry = {
			type: "MultiPolygon",
			coordinates: [[rect(-110, 36, -109, 37)], [rect(-120.5, 36.5, -120, 37)]]
		};
		const none: Geometry = {
			type: "MultiPolygon",
			coordinates: [[rect(-110, 36, -109, 37)], [rect(-130, 36, -129, 37)]]
		};
		expect(intersectsBounds(shape(some), V)).toBe(true);
		expect(intersectsBounds(shape(none), V)).toBe(false);
	});

	it("diagonal: bbox overlaps, area doesn't", () => {
		const tri = polygon([
			[-123, 40],
			[-120, 40],
			[-123, 37],
			[-123, 40]
		]);
		const [w, s, e, n] = geometryBbox(tri)!;
		expect(w <= V.east && e >= V.west && s <= V.north && n >= V.south).toBe(true);
		expect(intersectsBounds(shape(tri), V)).toBe(false);
	});

	it("a view inside a hole is not in view", () => {
		const outer = rect(-125, 30, -115, 42);
		const hole = rect(-122, 35, -118, 39);
		expect(intersectsBounds(shape(polygon(outer, hole)), V)).toBe(false);
		expect(intersectsBounds(shape(polygon(outer)), V)).toBe(true);
	});

	it("a line that crosses with no vertex inside", () => {
		const line: Geometry = {
			type: "LineString",
			coordinates: [
				[-122, 37],
				[-118, 37]
			]
		};
		expect(intersectsBounds(shape(line), V)).toBe(true);
	});

	it("no geometry: the label point test", () => {
		expect(intersectsBounds({ lngLat: [-120, 37] }, V)).toBe(true);
		expect(intersectsBounds({ lngLat: [-100, 37] }, V)).toBe(false);
	});

	it("a shape touching an edge is in view", () => {
		expect(intersectsBounds(shape(polygon(rect(-122, 36.5, -121, 37))), V)).toBe(true);
	});

	it("uses a given bbox for the pre-check", () => {
		const big = polygon(rect(-124, 26, -118, 39));
		// A (wrong) bbox far away: the pre-check rejects without the exact test.
		expect(intersectsBounds({ ...shape(big), bbox: [10, 10, 11, 11] }, V)).toBe(false);
	});

	it("degenerate shapes don't throw and aren't in view", () => {
		const twoPoints = polygon([
			[-110, 36],
			[-109, 37]
		]);
		const unclosed = polygon([
			[-110, 36],
			[-109, 36],
			[-109, 37]
		]);
		expect(intersectsBounds(shape(twoPoints), V)).toBe(false);
		expect(intersectsBounds(shape(unclosed), V)).toBe(false);
		expect(shapeAnchor(twoPoints, V, CENTER)).toBeNull();
		expect(shapeAnchor(unclosed, V, CENTER)).toBeNull();
	});
});

describe("geometryBbox", () => {
	it("measures each geometry type", () => {
		expect(geometryBbox({ type: "Point", coordinates: [1, 2] })).toEqual([1, 2, 1, 2]);
		expect(
			geometryBbox({
				type: "MultiPoint",
				coordinates: [
					[1, 2],
					[3, -1]
				]
			})
		).toEqual([1, -1, 3, 2]);
		expect(
			geometryBbox({
				type: "LineString",
				coordinates: [
					[1, 2],
					[3, 4]
				]
			})
		).toEqual([1, 2, 3, 4]);
		expect(
			geometryBbox({
				type: "MultiLineString",
				coordinates: [
					[
						[1, 2],
						[3, 4]
					],
					[[-1, 5]]
				]
			})
		).toEqual([-1, 2, 3, 5]);
		expect(geometryBbox(polygon(rect(0, 1, 2, 3)))).toEqual([0, 1, 2, 3]);
		expect(
			geometryBbox({
				type: "MultiPolygon",
				coordinates: [[rect(0, 1, 2, 3)], [rect(-5, 0, -4, 1)]]
			})
		).toEqual([-5, 0, 2, 3]);
		expect(
			geometryBbox({
				type: "GeometryCollection",
				geometries: [{ type: "Point", coordinates: [9, 9] }, polygon(rect(0, 1, 2, 3))]
			})
		).toEqual([0, 1, 9, 9]);
	});

	it("is null with no coordinates", () => {
		expect(geometryBbox({ type: "Polygon", coordinates: [] })).toBeNull();
	});
});

describe("shapeAnchor", () => {
	it("is the center when the shape contains it", () => {
		expect(shapeAnchor(polygon(rect(-124, 26, -118, 39)), V, CENTER)).toEqual(CENTER);
	});

	it("is inside the shape and the view when the shape misses the center", () => {
		const east = polygon(rect(-119.5, 30, -110, 40));
		const at = shapeAnchor(east, V, CENTER)!;
		expect(inside(at)).toBe(true);
		expect(containsPoint(east, at)).toBe(true);
	});

	it("is never in a hole over the center", () => {
		const holed = polygon(rect(-125, 30, -115, 42), rect(-120.5, 36.5, -119.5, 37.5));
		const at = shapeAnchor(holed, V, CENTER)!;
		expect(at).not.toEqual(CENTER);
		expect(inside(at)).toBe(true);
		expect(containsPoint(holed, at)).toBe(true);
	});

	it("finds a point when the visible part misses the middle line (a C shape)", () => {
		const c = polygon([
			[0, 0],
			[10, 0],
			[10, 2],
			[2, 2],
			[2, 8],
			[10, 8],
			[10, 10],
			[0, 10],
			[0, 0]
		]);
		const view = { west: 5, south: 0, east: 9, north: 10 };
		expect(intersectsBounds(shape(c), view)).toBe(true);
		const at = shapeAnchor(c, view, [7, 5])!;
		expect(at).not.toBeNull();
		expect(inside(at, view)).toBe(true);
		expect(containsPoint(c, at)).toBe(true);
	});

	it("finds a point in the bands around a hole that fills the middle line", () => {
		const holed = polygon(rect(0, 0, 10, 10), rect(1, 3, 9, 7));
		const view = { west: 2, south: 2, east: 8, north: 8 };
		const at = shapeAnchor(holed, view, [5, 5])!;
		expect(at).not.toBeNull();
		expect(inside(at, view)).toBe(true);
		expect(containsPoint(holed, at)).toBe(true);
	});

	it("is on the visible piece of a line", () => {
		const line: Geometry = {
			type: "LineString",
			coordinates: [
				[-122, 36.5],
				[-118, 36.5]
			]
		};
		const at = shapeAnchor(line, V, CENTER)!;
		expect(inside(at)).toBe(true);
		expect(at[1]).toBeCloseTo(36.5);
	});
});

describe("the 2026-11-08 plume", () => {
	const valley = { west: -122.51, south: 35.29, east: -116.89, north: 38.1 };
	const { geometry } = plumeFeature();
	const point = labelPoint(geometry)!;

	it("has its label point off the Valley view", () => {
		expect(inside(point, valley)).toBe(false);
	});

	it("is in view of the Valley", () => {
		expect(intersectsBounds({ lngLat: point, geometry }, valley)).toBe(true);
	});

	it("covers the Valley's center", () => {
		expect(containsPoint(geometry, [-119.7, 36.7])).toBe(true);
	});
});
