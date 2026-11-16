import type { FeatureCollection, Point, Polygon } from "geojson";
import type { MetadataProvider } from "../src/lib/data/metadata.js";
import type { Level, Scale, ScaleRef } from "../src/lib/data/scale-types.js";
import type { MapFeatureProperties } from "../src/lib/data/types.js";

// Mock pesticide use for the demo: a grid of townships (6×6 mi) around Fresno, each split into
// 36 sections (1 mi²), with made-up pounds, and spray notices on some sections. Static, so the
// demo and e2e need no server for it.

export interface UseProps extends MapFeatureProperties {
	/** Township id `T<row>-<col>`, or section id `T<row>-<col>-<n>`. */
	mtrs: string;
	topChemicals: string[];
	/** Pounds per month, oldest first (sections only). */
	monthly: number[];
	sections?: number;
}

export interface NoticeProps extends MapFeatureProperties {
	count: number;
	start: string;
	end: string;
	products: string[];
}

export const TOWNSHIPS_REF: ScaleRef = { dataset: "demo-pesticides", entryType: "township-lbs" };
export const SECTIONS_REF: ScaleRef = { dataset: "demo-pesticides", entryType: "section-lbs" };

const ROWS = 6;
const COLS = 7;
const ORIGIN: [number, number] = [-120.1, 36.45];
const MILE_LAT = 1 / 69;
const MILE_LNG = 1 / 55.4; // at about 36.7°N
const CHEMICALS = ["Sulfur", "Glyphosate", "1,3-Dichloropropene", "Chlorpyrifos", "Copper"];

/** A repeatable pseudo-random number in [0, 1) from a seed. */
function noise(seed: number): number {
	const x = Math.sin(seed * 12.9898) * 43758.5453;
	return x - Math.floor(x);
}

function square(x: number, y: number, w: number, h: number): Polygon {
	return {
		type: "Polygon",
		coordinates: [
			[
				[x, y],
				[x + w, y],
				[x + w, y + h],
				[x, y + h],
				[x, y]
			]
		]
	};
}

function level(key: string, label: string, color: string, min: number, max: number | null): Level {
	return {
		key,
		label,
		color,
		opacity: null,
		tier: null,
		description: "",
		guidance: "",
		min,
		max,
		value: null
	};
}

function lbsScale(id: string, breaks: number[]): Scale {
	const colors = ["#fde68a", "#fbbf24", "#f97316", "#c2410c", "#7c2d12"];
	const labels = breaks.map((b, i) =>
		i === breaks.length - 1
			? `${b.toLocaleString()}+`
			: `${b.toLocaleString()}–${breaks[i + 1].toLocaleString()}`
	);
	return {
		id,
		label: "Pesticide use",
		units: "lbs",
		kind: "range",
		source: null,
		averaging_hours: null,
		daily_statistic: null,
		daily_statistic_label: null,
		levels: breaks.map((b, i) => level(`l${i}`, labels[i], colors[i], b, breaks[i + 1] ?? null))
	};
}

export const TOWNSHIP_SCALE = lbsScale("township-lbs", [1, 5000, 20000, 60000, 150000]);
export const SECTION_SCALE = lbsScale("section-lbs", [1, 200, 800, 2500, 6000]);

/** The demo's metadata with the mock scales; everything else from `base`. */
export function withPesticideScales(base: MetadataProvider): MetadataProvider {
	const scales: Record<string, Scale> = {
		"township-lbs": TOWNSHIP_SCALE,
		"section-lbs": SECTION_SCALE
	};
	const provider = Object.create(base) as MetadataProvider;
	provider.scale = (ref, signal) =>
		ref.dataset === "demo-pesticides"
			? Promise.resolve(scales[ref.entryType] ?? "unavailable")
			: base.scale(ref, signal);
	provider.entryType = (ref, signal) =>
		ref.dataset === "demo-pesticides"
			? Promise.resolve("unavailable")
			: base.entryType(ref, signal);
	provider.attribution = (dataset, signal) =>
		dataset === "demo-pesticides"
			? Promise.resolve("unavailable")
			: base.attribution(dataset, signal);
	return provider;
}

const townshipKey = (r: number, c: number) => `feature:T${r}-${c}`;

export function pesticideData() {
	const townships: FeatureCollection<Polygon, UseProps> = {
		type: "FeatureCollection",
		features: []
	};
	const sections: FeatureCollection<Polygon, UseProps> = {
		type: "FeatureCollection",
		features: []
	};
	const notices: FeatureCollection<Point, NoticeProps> = {
		type: "FeatureCollection",
		features: []
	};
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			const tx = ORIGIN[0] + c * 6 * MILE_LNG;
			const ty = ORIGIN[1] + r * 6 * MILE_LAT;
			let total = 0;
			let withData = 0;
			for (let n = 0; n < 36; n++) {
				const seed = r * 1000 + c * 50 + n;
				// About one section in six has no reported use.
				const lbs = noise(seed) < 0.16 ? null : Math.round(noise(seed + 0.5) ** 2 * 9000);
				if (lbs !== null) {
					total += lbs;
					withData++;
				}
				const [sx, sy] = [tx + (n % 6) * MILE_LNG, ty + Math.floor(n / 6) * MILE_LAT];
				const mtrs = `T${r}-${c}-${n}`;
				sections.features.push({
					type: "Feature",
					geometry: square(sx, sy, MILE_LNG, MILE_LAT),
					properties: {
						refKey: `feature:${mtrs}`,
						name: `Section ${n + 1}, T${r}-${c}`,
						value: lbs,
						mtrs,
						topChemicals: CHEMICALS.filter((_, i) => noise(seed + i) > 0.55).slice(0, 3),
						monthly: Array.from({ length: 12 }, (_, m) =>
							lbs === null ? 0 : Math.round((lbs / 12) * (0.4 + noise(seed + m) * 1.2))
						)
					}
				});
				if (lbs !== null && noise(seed + 0.25) > 0.93) {
					const count = 1 + Math.floor(noise(seed + 0.75) * 4);
					notices.features.push({
						type: "Feature",
						geometry: { type: "Point", coordinates: [sx + MILE_LNG / 2, sy + MILE_LAT / 2] },
						properties: {
							refKey: `feature:notice-${mtrs}`,
							name: `Spray notices, section ${n + 1}, T${r}-${c}`,
							value: "notice",
							count,
							start: "2026-11-18",
							end: "2026-11-21",
							products: CHEMICALS.filter((_, i) => noise(seed * 3 + i) > 0.6).slice(0, 2)
						}
					});
				}
			}
			townships.features.push({
				type: "Feature",
				geometry: square(tx, ty, 6 * MILE_LNG, 6 * MILE_LAT),
				properties: {
					refKey: townshipKey(r, c),
					name: `Township T${r}-${c}`,
					value: withData ? total : null,
					mtrs: `T${r}-${c}`,
					topChemicals: CHEMICALS.filter((_, i) => noise(r * 7 + c + i) > 0.5).slice(0, 3),
					monthly: [],
					sections: withData
				}
			});
		}
	}
	/** The 3×3 townships around one, clipped to the grid. */
	const block = (refKey: string): string[] => {
		const m = /^feature:T(\d+)-(\d+)$/.exec(refKey);
		if (!m) return [];
		const [r, c] = [Number(m[1]), Number(m[2])];
		const out: string[] = [];
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				if (r + dr >= 0 && r + dr < ROWS && c + dc >= 0 && c + dc < COLS) {
					out.push(townshipKey(r + dr, c + dc));
				}
			}
		}
		return out;
	};
	const parentOf = (props: UseProps): string | null => {
		const m = /^(T\d+-\d+)-\d+$/.exec(props.mtrs);
		return m ? `feature:${m[1]}` : null;
	};
	/** Where the grid sits, for the camera. */
	const center: [number, number] = [
		ORIGIN[0] + (COLS * 6 * MILE_LNG) / 2,
		ORIGIN[1] + (ROWS * 6 * MILE_LAT) / 2
	];
	return { townships, sections, notices, block, parentOf, center };
}

/** A one-level category scale colouring every notice the notices' orange. */
export const NOTICE_SCALE: Scale = {
	id: "notices",
	label: "Spray notices",
	units: "",
	kind: "category",
	source: null,
	averaging_hours: null,
	daily_statistic: null,
	daily_statistic_label: null,
	levels: [
		{ ...level("notice", "Notice of intent", "#d35400", 0, null), value: "notice", min: null }
	]
};
