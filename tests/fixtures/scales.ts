import type { Level, Scale } from "../../src/lib/data/scale-types.js";

function range(
	key: string,
	label: string,
	color: string,
	min: number,
	max: number | null,
	tier: number | null,
	guidance = ""
): Level {
	return { key, label, color, opacity: null, tier, description: "", guidance, min, max };
}

export const pm25Scale: Scale = {
	id: "pm25",
	label: "PM2.5",
	units: "µg/m³",
	kind: "range",
	levels: [
		range("good", "Good", "#00e400", 0, 9.1, 0),
		range(
			"moderate",
			"Moderate",
			"#ffff00",
			9.1,
			35.5,
			1,
			"Highly sensitive groups should stay indoors and avoid outdoor activities."
		),
		range(
			"unhealthy_sensitive",
			"Unhealthy for Sensitive Groups",
			"#ff7e00",
			35.5,
			55.5,
			2,
			"Sensitive groups should stay indoors and avoid outdoor activities."
		),
		range(
			"unhealthy",
			"Unhealthy",
			"#ff0000",
			55.5,
			125.5,
			3,
			"Everyone should reduce prolonged or heavy exertion."
		),
		range(
			"very_unhealthy",
			"Very Unhealthy",
			"#8f3f97",
			125.5,
			225.5,
			4,
			"Everyone should avoid prolonged or heavy exertion."
		),
		range(
			"hazardous",
			"Hazardous",
			"#7e0023",
			225.5,
			null,
			4,
			"Everyone should stay indoors and avoid physical outdoor activities."
		)
	]
};

function category(
	key: string,
	label: string,
	color: string,
	value: string | number,
	opacity: number | null,
	tier: number | null
): Level {
	return { key, label, color, opacity, tier, description: "", guidance: "", value };
}

export const smokeScale: Scale = {
	id: "smoke-density",
	label: "Smoke density",
	units: "",
	kind: "category",
	levels: [
		category("light", "Light", "#bfc8c3", "light", 0.2, 1),
		category("medium", "Medium", "#757b78", "medium", 0.3, 2),
		category("heavy", "Heavy", "#333634", "heavy", 0.4, 3)
	]
};

export const fireScale: Scale = {
	id: "fire-frp",
	label: "Fire radiative power",
	units: "MW",
	kind: "range",
	levels: [
		range("lt10", "<10", "#FFD700", 0, 10, null),
		range("10-49", "10–49", "#FF8C00", 10, 50, null),
		range("50-149", "50–149", "#FF4500", 50, 150, null),
		range("150-349", "150–349", "#DC143C", 150, 350, null),
		range("gte350", "≥350", "#8B0000", 350, null, null)
	]
};

export const heatScale: Scale = {
	id: "heat-score",
	label: "Heat score",
	units: "",
	kind: "category",
	levels: [
		category("none", "None", "#DEDEDE", 0, null, null),
		category("minor", "Minor", "#fae0c8", 1, null, null),
		category("moderate", "Moderate", "#ea8753", 2, null, null),
		category("major", "Major", "#c23a00", 3, null, null),
		category("extreme", "Extreme", "#700006", 4, null, null)
	]
};

export const burnScale: Scale = {
	id: "burn-status",
	label: "Burn status",
	units: "",
	kind: "category",
	levels: [category("burn", "Burn", "", "burn", null, null)]
};
