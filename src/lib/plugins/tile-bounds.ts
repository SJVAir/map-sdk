import type { Bbox } from "../core/shape-view.js";

const lng = (x: number, n: number) => (x / n) * 360 - 180;
const lat = (y: number, n: number) =>
	(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

/**
 * A MapLibre `sourcedata` event's tile, as lng/lat bounds: from its `tileID.canonical` `{ z, x, y }`
 * (Web Mercator XYZ). Null for anything else, so an unexpected shape is simply no tile.
 */
export function tileBounds(tile: unknown): Bbox | null {
	const canonical = (tile as { tileID?: { canonical?: { z?: unknown; x?: unknown; y?: unknown } } })
		?.tileID?.canonical;
	if (!canonical) return null;
	const { z, x, y } = canonical;
	if (typeof z !== "number" || typeof x !== "number" || typeof y !== "number") return null;
	const n = 2 ** z;
	return [lng(x, n), lat(y + 1, n), lng(x + 1, n), lat(y, n)];
}
