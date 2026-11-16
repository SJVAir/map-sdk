import type { FeatureCollection, Polygon } from "geojson";
import type { MapFeatureProperties } from "../../src/lib/data/types.js";

/**
 * A grid of parents (townships) `T<row>-<col>`, each split into 2×2 children (sections)
 * `T<row>-<col>-S<n>`, as squares of `size` degrees from `origin`. refKeys are `feature:` refs.
 */
export interface GridOptions {
	rows?: number;
	cols?: number;
	origin?: [number, number];
	size?: number;
	/** A child's value (default: its index); null leaves it with no figure. */
	value?(parent: string, n: number): number | null;
}

const square = (x: number, y: number, s: number): Polygon => ({
	type: "Polygon",
	coordinates: [
		[
			[x, y],
			[x + s, y],
			[x + s, y + s],
			[x, y + s],
			[x, y]
		]
	]
});

export const parentKey = (row: number, col: number) => `feature:T${row}-${col}`;

export function lensGrid(options: GridOptions = {}) {
	const { rows = 5, cols = 5, origin = [0, 0], size = 1 } = options;
	const parents: FeatureCollection<Polygon, MapFeatureProperties> = {
		type: "FeatureCollection",
		features: []
	};
	const children: FeatureCollection<Polygon, MapFeatureProperties> = {
		type: "FeatureCollection",
		features: []
	};
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const key = parentKey(r, c);
			const [x, y] = [origin[0] + c * size, origin[1] + r * size];
			parents.features.push({
				type: "Feature",
				geometry: square(x, y, size),
				properties: { refKey: key, name: `T${r}-${c}`, value: (r * cols + c) * 10 }
			});
			for (let n = 0; n < 4; n++) {
				const half = size / 2;
				children.features.push({
					type: "Feature",
					geometry: square(x + (n % 2) * half, y + Math.floor(n / 2) * half, half),
					properties: {
						refKey: `${key}-S${n}`,
						name: `T${r}-${c} S${n}`,
						value: options.value ? options.value(key, n) : n
					}
				});
			}
		}
	}
	/** The 3×3 around a parent, clipped to the grid. */
	const block = (refKey: string): string[] => {
		const m = /^feature:T(\d+)-(\d+)$/.exec(refKey);
		if (!m) return [];
		const [r, c] = [Number(m[1]), Number(m[2])];
		const out: string[] = [];
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				const [rr, cc] = [r + dr, c + dc];
				if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(parentKey(rr, cc));
			}
		}
		return out;
	};
	const parentOf = (props: MapFeatureProperties): string | null =>
		/^(feature:T\d+-\d+)-S\d+$/.exec(props.refKey)?.[1] ?? null;
	return { parents, children, block, parentOf };
}
