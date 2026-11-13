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
	return {
		key,
		label,
		color,
		opacity: null,
		tier,
		description: "",
		guidance,
		min,
		max,
		value: null
	};
}

export const pm25Scale: Scale = {
	id: "pm25",
	label: "PM2.5",
	units: "µg/m³",
	kind: "range",
	source: null,
	averaging_hours: null,
	daily_statistic: null,
	daily_statistic_label: null,
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
	return {
		key,
		label,
		color,
		opacity,
		tier,
		description: "",
		guidance: "",
		min: null,
		max: null,
		value
	};
}

export const smokeScale: Scale = {
	id: "smoke-density",
	label: "Smoke Density",
	units: "",
	kind: "category",
	source: null,
	averaging_hours: null,
	daily_statistic: null,
	daily_statistic_label: null,
	levels: [
		category("light", "Light", "#bfc8c3", "light", 0.2, 1),
		category("medium", "Medium", "#757b78", "medium", 0.3, 2),
		category("heavy", "Heavy", "#333634", "heavy", 0.4, 3)
	]
};

export const fireScale: Scale = {
	id: "fire-frp",
	label: "Fire Radiative Power",
	units: "MW",
	kind: "range",
	source: null,
	averaging_hours: null,
	daily_statistic: null,
	daily_statistic_label: null,
	levels: [
		range("sm", "<10", "#FFD700", 0, 10, null),
		range("md", "10–49", "#FF8C00", 10, 50, null),
		range("lg", "50–149", "#FF4500", 50, 150, null),
		range("xl", "150–349", "#DC143C", 150, 350, null),
		range("xxl", "≥350", "#8B0000", 350, null, null)
	]
};

export const heatScale: Scale = {
	id: "heat-score",
	label: "Heat Score",
	units: "",
	kind: "category",
	source: { name: "CalHeatScore (CalEPA / OEHHA)", url: "https://calheatscore.calepa.ca.gov/" },
	averaging_hours: null,
	daily_statistic: null,
	daily_statistic_label: null,
	levels: [
		{
			key: "low",
			label: "Low",
			color: "#DEDEDE",
			opacity: null,
			tier: 0,
			description: "Little to no heat-related health impacts are expected.",
			guidance: "",
			min: null,
			max: null,
			value: 0
		},
		{
			key: "mild",
			label: "Mild",
			color: "#fae0c8",
			opacity: null,
			tier: 1,
			description:
				"Warm day. A minor increase in heat-related health impacts is expected among those sensitive to heat.",
			guidance: "People sensitive to heat should drink extra water and take breaks somewhere cool.",
			min: null,
			max: null,
			value: 1
		},
		{
			key: "moderate",
			label: "Moderate",
			color: "#ea8753",
			opacity: null,
			tier: 2,
			description:
				"Very warm day. A moderate increase in heat-related health impacts is expected among those sensitive to heat.",
			guidance:
				"People sensitive to heat should limit time outdoors in the afternoon, drink extra water, and stay somewhere cool during the hottest hours.",
			min: null,
			max: null,
			value: 2
		},
		{
			key: "high",
			label: "High",
			color: "#c23a00",
			opacity: null,
			tier: 3,
			description:
				"Hot day. An increase in heat-related health impacts is expected for everyone, especially those without access to adequate cooling and hydration or those engaged in strenuous physical activity outdoors. This level of heat can pose a significant risk to health.",
			guidance:
				"Everyone should drink extra water, limit strenuous outdoor activity, and spend the hottest hours somewhere cool.",
			min: null,
			max: null,
			value: 3
		},
		{
			key: "severe",
			label: "Severe",
			color: "#700006",
			opacity: null,
			tier: 4,
			description:
				"Extreme heat day. A major increase in heat-related health impacts is expected for everyone, especially those without access to adequate cooling and hydration or those engaged in strenuous physical activity outdoors. This level of heat can pose a very serious risk to health.",
			guidance:
				"Everyone should stay somewhere cool when possible, drink at least 2 glasses of water an hour, and check on people at higher risk.",
			min: null,
			max: null,
			value: 4
		}
	]
};

export const burnScale: Scale = {
	id: "burn-status",
	label: "Burn status",
	units: "",
	kind: "category",
	source: null,
	averaging_hours: null,
	daily_statistic: null,
	daily_statistic_label: null,
	levels: [category("discouraged", "Burning Discouraged", "", "discouraged", null, null)]
};
