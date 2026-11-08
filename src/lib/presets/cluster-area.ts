import area from "@turf/area";
import { convertArea, polygon } from "@turf/helpers";

type Point = [number, number];

const cross = (o: Point, a: Point, b: Point) =>
	(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * The convex hull of lng/lat points (monotone chain): counter-clockwise, without a repeated
 * closing point, inner and collinear points dropped. Fewer than 3 points means no area.
 */
export function convexHull(points: Point[]): Point[] {
	const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (sorted.length < 3) return sorted;
	const half = (from: Point[]) => {
		const chain: Point[] = [];
		for (const p of from) {
			while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0)
				chain.pop();
			chain.push(p);
		}
		chain.pop();
		return chain;
	};
	return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * The area, in square miles, of the smallest shape around a cluster's monitors (their convex
 * hull), as sjvair.com's map computed area: `@turf/area`, then `convertArea`. 0 for fewer than 3
 * points not on one line.
 */
export function clusterAreaSqMiles(points: Point[]): number {
	const hull = convexHull(points);
	if (hull.length < 3) return 0;
	return convertArea(area(polygon([[...hull, hull[0]]])), "meters", "miles");
}
