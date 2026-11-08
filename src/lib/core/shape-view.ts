import type { Geometry, Position } from "geojson";
import type { Bounds } from "./create-map.svelte.js";

/**
 * Shapes against the view: a geometry's bounding box, whether it overlaps the view, and a point of
 * it inside the view. Coordinates are planar lng/lat (as `labelPoint`); no antimeridian handling.
 */

/** `[west, south, east, north]`. */
export type Bbox = [west: number, south: number, east: number, north: number];
type Pt = [number, number];

/** The geometry's bounding box, or `null` when it has no coordinates. */
export function geometryBbox(geometry: Geometry): Bbox | null {
	let west = Infinity;
	let south = Infinity;
	let east = -Infinity;
	let north = -Infinity;
	const add = (p: Position) => {
		if (p[0] < west) west = p[0];
		if (p[0] > east) east = p[0];
		if (p[1] < south) south = p[1];
		if (p[1] > north) north = p[1];
	};
	const walk = (g: Geometry) => {
		switch (g.type) {
			case "Point":
				add(g.coordinates);
				break;
			case "MultiPoint":
			case "LineString":
				g.coordinates.forEach(add);
				break;
			case "MultiLineString":
			case "Polygon":
				g.coordinates.forEach((ring) => ring.forEach(add));
				break;
			case "MultiPolygon":
				g.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(add)));
				break;
			case "GeometryCollection":
				g.geometries.forEach(walk);
				break;
		}
	};
	walk(geometry);
	return west <= east ? [west, south, east, north] : null;
}

const inRect = (p: Position, b: Bounds) =>
	p[0] >= b.west && p[0] <= b.east && p[1] >= b.south && p[1] <= b.north;

/** The polygons of a geometry (each an outer ring and holes), or `null` for a non-polygon. */
function polygonsOf(g: Geometry): Position[][][] | null {
	if (g.type === "Polygon") return [g.coordinates];
	if (g.type === "MultiPolygon") return g.coordinates;
	return null;
}

function linesOf(g: Geometry): Position[][] | null {
	if (g.type === "LineString") return [g.coordinates];
	if (g.type === "MultiLineString") return g.coordinates;
	return null;
}

/** Ring edges, closing an unclosed ring. Fewer than 3 points: no area, so no edges. */
function ringEdges(ring: Position[]): Array<[Position, Position]> {
	const n = ring.length;
	if (n < 3) return [];
	const edges: Array<[Position, Position]> = [];
	for (let i = 0; i < n - 1; i++) edges.push([ring[i], ring[i + 1]]);
	const [a, z] = [ring[0], ring[n - 1]];
	if (a[0] !== z[0] || a[1] !== z[1]) edges.push([z, a]);
	return edges;
}

function inRing(p: Pt, ring: Position[]): boolean {
	let inside = false;
	for (const [a, b] of ringEdges(ring)) {
		if (a[1] > p[1] !== b[1] > p[1]) {
			const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
			if (p[0] < x) inside = !inside;
		}
	}
	return inside;
}

function inPolygon(p: Pt, polygon: Position[][]): boolean {
	const [outer, ...holes] = polygon;
	return !!outer && inRing(p, outer) && !holes.some((hole) => inRing(p, hole));
}

/** Inside an outer ring and outside its holes, for any polygon of the geometry. */
export function containsPoint(geometry: Geometry, p: [number, number]): boolean {
	return polygonsOf(geometry)?.some((polygon) => inPolygon(p, polygon)) ?? false;
}

const cross = (o: Position, a: Position, b: Position) =>
	(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (p: Position, a: Position, b: Position) =>
	Math.min(a[0], b[0]) <= p[0] &&
	p[0] <= Math.max(a[0], b[0]) &&
	Math.min(a[1], b[1]) <= p[1] &&
	p[1] <= Math.max(a[1], b[1]);

/** Whether segments ab and cd meet, touching and collinear overlaps included. */
function segmentsMeet(a: Position, b: Position, c: Position, d: Position): boolean {
	const d1 = cross(c, d, a);
	const d2 = cross(c, d, b);
	const d3 = cross(a, b, c);
	const d4 = cross(a, b, d);
	if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
		return true;
	return (
		(d1 === 0 && onSegment(a, c, d)) ||
		(d2 === 0 && onSegment(b, c, d)) ||
		(d3 === 0 && onSegment(c, a, b)) ||
		(d4 === 0 && onSegment(d, a, b))
	);
}

function rectCorners(b: Bounds): Pt[] {
	return [
		[b.west, b.south],
		[b.east, b.south],
		[b.east, b.north],
		[b.west, b.north]
	];
}

function segmentHitsRect(a: Position, b: Position, r: Bounds): boolean {
	if (inRect(a, r) || inRect(b, r)) return true;
	const c = rectCorners(r);
	return c.some((p, i) => segmentsMeet(a, b, p, c[(i + 1) % 4]));
}

function polygonHitsRect(polygon: Position[][], r: Bounds): boolean {
	const edges = polygon.flatMap(ringEdges);
	if (edges.length === 0) return false;
	if (edges.some(([a]) => inRect(a, r))) return true;
	if (rectCorners(r).some((p) => inPolygon(p, polygon))) return true;
	return edges.some(([a, b]) => segmentHitsRect(a, b, r));
}

/**
 * Whether the item is in view: a shape (`geometry`) when it intersects `bounds` (bbox pre-check,
 * then the exact test; holes count), anything else when its `lngLat` is inside. Edges included.
 */
export function intersectsBounds(
	item: { lngLat: [number, number]; geometry?: Geometry; bbox?: Bbox },
	bounds: Bounds
): boolean {
	const { geometry } = item;
	const polygons = geometry && polygonsOf(geometry);
	const lines = geometry && linesOf(geometry);
	if (!geometry || (!polygons && !lines && geometry.type !== "Point")) {
		return inRect(item.lngLat, bounds);
	}
	if (geometry.type === "Point") return inRect(geometry.coordinates, bounds);
	const box = item.bbox ?? geometryBbox(geometry);
	if (
		!box ||
		box[0] > bounds.east ||
		box[2] < bounds.west ||
		box[1] > bounds.north ||
		box[3] < bounds.south
	) {
		return false;
	}
	if (polygons) return polygons.some((polygon) => polygonHitsRect(polygon, bounds));
	return lines!.some((line) =>
		line.some((p, i) =>
			i === 0 ? line.length === 1 && inRect(p, bounds) : segmentHitsRect(line[i - 1], p, bounds)
		)
	);
}

/** Sutherland–Hodgman: the ring clipped to the rectangle (open, no repeated first point). */
function clipRing(ring: Position[], r: Bounds): Pt[] {
	let pts: Pt[] = ringEdges(ring).map(([a]) => [a[0], a[1]]);
	const sides: Array<[(p: Pt) => boolean, (a: Pt, b: Pt) => Pt]> = [
		[(p) => p[0] >= r.west, (a, b) => atX(a, b, r.west)],
		[(p) => p[0] <= r.east, (a, b) => atX(a, b, r.east)],
		[(p) => p[1] >= r.south, (a, b) => atY(a, b, r.south)],
		[(p) => p[1] <= r.north, (a, b) => atY(a, b, r.north)]
	];
	for (const [keep, cut] of sides) {
		const out: Pt[] = [];
		for (let i = 0; i < pts.length; i++) {
			const cur = pts[i];
			const prev = pts[(i + pts.length - 1) % pts.length];
			if (keep(cur)) {
				if (!keep(prev)) out.push(cut(prev, cur));
				out.push(cur);
			} else if (keep(prev)) {
				out.push(cut(prev, cur));
			}
		}
		pts = out;
		if (pts.length === 0) break;
	}
	return pts;
}

const atX = (a: Pt, b: Pt, x: number): Pt => [
	x,
	a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])
];
const atY = (a: Pt, b: Pt, y: number): Pt => [
	a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]),
	y
];

function openArea(pts: Pt[]): number {
	let area = 0;
	for (let i = 0; i < pts.length; i++) {
		const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
		area += a[0] * b[1] - b[0] * a[1];
	}
	return Math.abs(area) / 2;
}

/** The midpoint of the widest interior span of a horizontal line through the clipped polygon. */
function polygonInteriorPoint(rings: Pt[][]): Pt | null {
	const outer = rings[0];
	let south = Infinity;
	let north = -Infinity;
	for (const p of outer) {
		south = Math.min(south, p[1]);
		north = Math.max(north, p[1]);
	}
	if (!(north > south)) return null;
	let y = (south + north) / 2;
	const vertexAt = (yy: number) => rings.some((ring) => ring.some((p) => p[1] === yy));
	if (vertexAt(y)) y += (north - south) * 1e-9;
	const xs: number[] = [];
	for (const ring of rings) {
		for (let i = 0; i < ring.length; i++) {
			const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
			if (a[1] > y !== b[1] > y) xs.push(atY(a, b, y)[0]);
		}
	}
	xs.sort((a, b) => a - b);
	let best: Pt | null = null;
	let width = 0;
	for (let i = 0; i + 1 < xs.length; i += 2) {
		if (xs[i + 1] - xs[i] > width) {
			width = xs[i + 1] - xs[i];
			best = [(xs[i] + xs[i + 1]) / 2, y];
		}
	}
	return best;
}

/** Liang–Barsky: the segment clipped to the rectangle, or `null` when it misses. */
function clipSegment(a: Position, b: Position, r: Bounds): [Pt, Pt] | null {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	let t0 = 0;
	let t1 = 1;
	const checks: Array<[number, number]> = [
		[-dx, a[0] - r.west],
		[dx, r.east - a[0]],
		[-dy, a[1] - r.south],
		[dy, r.north - a[1]]
	];
	for (const [p, q] of checks) {
		if (p === 0) {
			if (q < 0) return null;
		} else {
			const t = q / p;
			if (p < 0) t0 = Math.max(t0, t);
			else t1 = Math.min(t1, t);
			if (t0 > t1) return null;
		}
	}
	return [
		[a[0] + t0 * dx, a[1] + t0 * dy],
		[a[0] + t1 * dx, a[1] + t1 * dy]
	];
}

/**
 * A point of the shape inside `view`: `center` when the shape contains it; otherwise a point well
 * inside the shape's visible part (polygons: the largest clipped one, never in a hole; lines: the
 * middle of the longest visible piece); `null` when nothing of it is visible.
 */
export function shapeAnchor(
	geometry: Geometry,
	view: Bounds,
	center: [number, number]
): [number, number] | null {
	const polygons = polygonsOf(geometry);
	if (polygons) {
		if (inRect(center, view) && containsPoint(geometry, center)) return center;
		let best: Pt[][] | null = null;
		let bestArea = 0;
		for (const polygon of polygons) {
			if (!polygon[0] || ringEdges(polygon[0]).length === 0) continue;
			const rings = polygon.map((ring) => clipRing(ring, view));
			const area = rings[0].length >= 3 ? openArea(rings[0]) : 0;
			if (area > bestArea) {
				bestArea = area;
				best = rings.filter((ring, i) => i === 0 || ring.length >= 3);
			}
		}
		return best ? polygonInteriorPoint(best) : null;
	}
	const lines = linesOf(geometry);
	if (lines) {
		let best: Pt | null = null;
		let length = -1;
		for (const line of lines) {
			for (let i = 1; i < line.length; i++) {
				const piece = clipSegment(line[i - 1], line[i], view);
				if (!piece) continue;
				const len = Math.hypot(piece[1][0] - piece[0][0], piece[1][1] - piece[0][1]);
				if (len > length) {
					length = len;
					best = [(piece[0][0] + piece[1][0]) / 2, (piece[0][1] + piece[1][1]) / 2];
				}
			}
		}
		return best;
	}
	return null;
}
