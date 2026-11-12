import type { FocusGeometry } from "../src/lib/index.js";

// Demo focus areas. The county outline is drawn by hand and only roughly Fresno County's shape:
// it is here to show the wash and outline, not to be a boundary.

const FRESNO_COUNTY_APPROX: [number, number][] = [
	[-120.92, 36.74],
	[-120.6, 37.04],
	[-120.06, 37.17],
	[-119.65, 37.42],
	[-119.31, 37.55],
	[-118.79, 37.47],
	[-118.36, 37.16],
	[-118.6, 36.68],
	[-119.06, 36.42],
	[-119.47, 36.27],
	[-119.96, 36.2],
	[-120.42, 36.0],
	[-120.65, 36.33],
	[-120.92, 36.74]
];

const BAKERSFIELD_BOX: [number, number][] = [
	[-119.15, 35.3],
	[-118.9, 35.3],
	[-118.9, 35.45],
	[-119.15, 35.45],
	[-119.15, 35.3]
];

export interface FocusChoice {
	key: string;
	label: string;
	geometry: FocusGeometry | null;
	pinLabel?: string;
}

/** `near` places "Your location" just east of a monitor, off its marker. */
export function focusChoices(alpha: [number, number]): FocusChoice[] {
	return [
		{ key: "none", label: "None", geometry: null },
		{
			key: "county",
			label: "Fresno County (approximate)",
			geometry: { type: "Polygon", coordinates: [FRESNO_COUNTY_APPROX] }
		},
		{
			key: "two",
			label: "Two areas",
			geometry: { type: "MultiPolygon", coordinates: [[FRESNO_COUNTY_APPROX], [BAKERSFIELD_BOX]] }
		},
		{
			key: "location",
			label: "Your location",
			geometry: { type: "Point", coordinates: [alpha[0] + 0.012, alpha[1]] },
			pinLabel: "Your location"
		},
		{
			key: "at-monitor",
			label: "A school at a monitor",
			geometry: { type: "Point", coordinates: alpha },
			pinLabel: "Lincoln Elementary"
		}
	];
}
