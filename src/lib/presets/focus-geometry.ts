import type { MultiPolygon, Point, Polygon, Position } from "geojson";

/** What a focus area can mark: an area, or a place. */
export type FocusGeometry = Polygon | MultiPolygon | Point;

/** The ring that covers the world, counter-clockwise (Web Mercator's latitude limit, about). */
const WORLD_RING: Position[] = [
	[-180, -85],
	[180, -85],
	[180, 85],
	[-180, 85],
	[-180, -85]
];

/** Twice the signed area of a ring: positive when counter-clockwise. */
function signedArea(ring: Position[]): number {
	let sum = 0;
	for (let i = 0; i < ring.length - 1; i++) {
		sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
	}
	return sum;
}

const isFiniteNumber = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n);

/** Throws unless `geometry` is a Polygon, MultiPolygon, Point (with finite coordinates), or null. */
export function assertFocusGeometry(geometry: unknown): asserts geometry is FocusGeometry | null {
	if (geometry === null) return;
	const type =
		typeof geometry === "object" && typeof (geometry as { type?: unknown }).type === "string"
			? (geometry as { type: string }).type
			: "unknown";
	const coordinates = (geometry as { coordinates?: unknown } | undefined)?.coordinates;
	const ok =
		type === "Point"
			? Array.isArray(coordinates) &&
				isFiniteNumber(coordinates[0]) &&
				isFiniteNumber(coordinates[1])
			: (type === "Polygon" || type === "MultiPolygon") && Array.isArray(coordinates);
	if (!ok) {
		throw new Error(
			`map-sdk: focusAreaPlugin takes a Polygon, MultiPolygon or Point, not ${type}` +
				(type === "Point" ? " without finite coordinates" : "")
		);
	}
}

/**
 * The wash outside an area: the world ring with each part's outer ring punched out, clockwise.
 * MapLibre tells holes from outer rings by winding, so a hole wound like the world ring would
 * start a second polygon instead. A part's own holes stay covered. Rings with fewer than four
 * positions are skipped.
 */
export function worldMask(geometry: Polygon | MultiPolygon): Polygon {
	const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
	const holes: Position[][] = [];
	for (const part of parts) {
		const outer = part[0];
		if (!outer || outer.length < 4) continue;
		holes.push(signedArea(outer) > 0 ? outer.toReversed() : outer);
	}
	return { type: "Polygon", coordinates: [WORLD_RING.map((p) => [...p]), ...holes] };
}
