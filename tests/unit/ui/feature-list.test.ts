import { describe, expect, it } from "vitest";
import type { FeatureListItem } from "../../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../../src/lib/data/format.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";
import type { Level } from "../../../src/lib/data/scale-types.js";
import { burnScale, heatScale, smokeScale } from "../../fixtures/scales.js";
import {
	inView,
	optionIdPart,
	levelText,
	rowLabel,
	shownValue,
	sortItems,
	typeaheadIndex
} from "../../../src/lib/ui/feature-list.js";

function level(label: string, tier: number, color = "#00e400"): Level {
	return {
		key: label,
		label,
		color,
		opacity: null,
		tier,
		description: "",
		guidance: "",
		min: null,
		max: null,
		value: null
	};
}

const good = level("Good", 0);

function item(id: string, name: string, extra: Partial<FeatureListItem> = {}): FeatureListItem {
	return {
		refKey: `monitor:${id}`,
		ref: { kind: "monitor", id },
		name,
		value: 1,
		level: good,
		units: "µg/m³",
		lngLat: [-119.5, 36.5],
		selectable: true,
		...extra
	};
}

const names = (items: FeatureListItem[]) => items.map((i) => i.name);

describe("inView", () => {
	const bounds = { west: -120, south: 36, east: -119, north: 37 };

	it("keeps a shape that covers the bounds though its label point is outside", () => {
		const cover = item("6", "Cover", {
			lngLat: [-121, 32],
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[-122, 30],
						[-118, 30],
						[-118, 38],
						[-122, 38],
						[-122, 30]
					]
				]
			}
		});
		const away = item("7", "Away", { lngLat: [-121, 32] });
		expect(names(inView([cover, away], bounds))).toEqual(["Cover"]);
	});

	it("keeps only items inside the bounds", () => {
		const items = [
			item("1", "In", { lngLat: [-119.5, 36.5] }),
			item("2", "West", { lngLat: [-120.5, 36.5] }),
			item("3", "North", { lngLat: [-119.5, 37.5] }),
			item("4", "East", { lngLat: [-118.9, 36.5] }),
			item("5", "South", { lngLat: [-119.5, 35.9] })
		];
		expect(names(inView(items, bounds))).toEqual(["In"]);
	});

	it("keeps a point exactly on an edge or corner", () => {
		const items = [
			item("1", "West edge", { lngLat: [-120, 36.5] }),
			item("2", "North edge", { lngLat: [-119.5, 37] }),
			item("3", "Corner", { lngLat: [-119, 36] })
		];
		expect(names(inView(items, bounds))).toEqual(["West edge", "North edge", "Corner"]);
	});
});

describe("sortItems", () => {
	it("sorts by value descending with null values and no level last", () => {
		const items = [
			item("1", "Low", { value: 2 }),
			item("2", "Null", { value: null, level: NO_LEVEL }),
			item("3", "High", { value: 40 }),
			item("4", "Negative", { value: -3, level: NO_LEVEL }),
			item("5", "Mid", { value: 12 })
		];
		expect(names(sortItems(items, "value"))).toEqual(["High", "Mid", "Low", "Negative", "Null"]);
		// Doesn't sort in place.
		expect(names(items)[0]).toBe("Low");
	});

	it("sorts category values by level tier, highest first", () => {
		const items = [
			item("1", "Light", { value: "light", level: level("Light", 1) }),
			item("2", "Heavy", { value: "heavy", level: level("Heavy", 3) }),
			item("3", "None", { value: null, level: NO_LEVEL })
		];
		expect(names(sortItems(items, "value"))).toEqual(["Heavy", "Light", "None"]);
	});

	it("sorts by name with an en-US collator", () => {
		const items = [item("1", "fresno"), item("2", "Bakersfield"), item("3", "Éxeter")];
		expect(names(sortItems(items, "name"))).toEqual(["Bakersfield", "Éxeter", "fresno"]);
	});
});

describe("typeaheadIndex", () => {
	const items = [item("1", "Arvin"), item("2", "Bakersfield"), item("3", "Avenal")];

	it("finds the next name starting with the query, ignoring case", () => {
		expect(typeaheadIndex(items, "a", 1)).toBe(2);
		expect(typeaheadIndex(items, "BAK", 0)).toBe(1);
	});

	it("wraps past the end", () => {
		expect(typeaheadIndex(items, "ar", 2)).toBe(0);
	});

	it("returns -1 when nothing matches", () => {
		expect(typeaheadIndex(items, "z", 0)).toBe(-1);
		expect(typeaheadIndex([], "a", 0)).toBe(-1);
	});
});

describe("rowLabel", () => {
	const format = createDefaultFormat();

	it("reads a detail in place of No level, with no reading", () => {
		const ev = { value: null, level: NO_LEVEL, detail: "Level 2 charger" } as const;
		expect(rowLabel(item("1", "Fresno Station", ev), defaultMessages, format)).toBe(
			"Fresno Station, Level 2 charger"
		);
	});

	it("reads a cut-off value when the item asks for one", () => {
		const extra = { value: 9.96, precision: 1, truncate: true, units: "MW" } as const;
		const label = rowLabel(item("1", "3 fire detections", extra), defaultMessages, format);
		expect(label).toContain("9.9 MW");
		expect(label).not.toContain("10.0");
	});

	it("reads a detail in the level's place after a value", () => {
		const extra = { value: 5, level: NO_LEVEL, detail: "Level 2 charger" } as const;
		expect(rowLabel(item("1", "Fresno Station", extra), defaultMessages, format)).toBe(
			"Fresno Station, 5 µg/m³, Level 2 charger"
		);
	});

	it("reads the level, not the detail, when there is a level", () => {
		expect(
			rowLabel(item("1", "Fresno", { detail: "Level 2 charger" }), defaultMessages, format)
		).toBe("Fresno, 1 µg/m³, Good");
	});

	it("treats a detail of only spaces as none", () => {
		const extra = { value: null, level: NO_LEVEL, detail: "  " } as const;
		expect(rowLabel(item("1", "Fresno Station", extra), defaultMessages, format)).toBe(
			"Fresno Station, no reading"
		);
		expect(levelText(item("1", "A", { level: NO_LEVEL, detail: " " }), defaultMessages)).toEqual({
			kind: "none",
			text: "No level"
		});
	});

	it("trims a detail's spaces", () => {
		const extra = { value: null, level: NO_LEVEL, detail: " Level 2 charger " } as const;
		expect(rowLabel(item("1", "Fresno Station", extra), defaultMessages, format)).toBe(
			"Fresno Station, Level 2 charger"
		);
	});

	it("treats an empty detail as none", () => {
		const extra = { value: null, level: NO_LEVEL, detail: "" } as const;
		expect(rowLabel(item("1", "Fresno Station", extra), defaultMessages, format)).toBe(
			"Fresno Station, no reading"
		);
	});

	it("rounds the value to the item's precision", () => {
		expect(
			rowLabel(item("1", "Fresno", { value: 7.971, precision: 1 }), defaultMessages, format)
		).toBe("Fresno, 8.0 µg/m³, Good");
		expect(
			rowLabel(item("1", "Fresno", { value: 7.971, precision: 0 }), defaultMessages, format)
		).toBe("Fresno, 8 µg/m³, Good");
	});

	it("reads the name, formatted value, units, and level label", () => {
		expect(rowLabel(item("1", "Fresno", { value: 1234.5 }), defaultMessages, format)).toBe(
			"Fresno, 1,234.5 µg/m³, Good"
		);
	});

	it("uses the no-value message for a null value", () => {
		const label = rowLabel(
			item("1", "Fresno", { value: null, level: NO_LEVEL }),
			defaultMessages,
			format
		);
		expect(label).toBe("Fresno, no reading");
	});

	it("says No level for a value without one, and an empty-color level's own label", () => {
		expect(rowLabel(item("1", "A", { value: -3, level: NO_LEVEL }), defaultMessages, format)).toBe(
			"A, -3 µg/m³, No level"
		);
		expect(
			rowLabel(
				item("1", "B", { value: 5, level: level("Unknown", 0, "") }),
				defaultMessages,
				format
			)
		).toBe("B, 5 µg/m³, Unknown");
	});

	it("uses the no-units message when units are empty", () => {
		expect(
			rowLabel(item("1", "Fire", { value: "heavy", units: "" }), defaultMessages, format)
		).toBe("Fire, heavy, Good");
	});
});

describe("optionIdPart", () => {
	it("is a valid id fragment, stable, and different for different keys", () => {
		const a = optionIdPart("monitors", "monitor:1");
		expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(optionIdPart("monitors", "monitor:1")).toBe(a);
		expect(optionIdPart("monitors", "monitor:2")).not.toBe(a);
		expect(optionIdPart("monitors:monitor", "1")).not.toBe(optionIdPart("monitors", "monitor:1"));
		expect(optionIdPart("a_3a_", "b")).not.toBe(optionIdPart("a:", "b"));
		expect(optionIdPart("a--b", "c")).not.toBe(optionIdPart("a", "b--c"));
		expect(optionIdPart("a-", "-b")).not.toBe(optionIdPart("a", "--b"));
	});
});

describe("levelText", () => {
	it("is the level's label, else a detail, else No level", () => {
		expect(levelText(item("1", "A", { detail: "x" }), defaultMessages)).toEqual({
			kind: "level",
			text: "Good"
		});
		expect(
			levelText(item("1", "A", { level: NO_LEVEL, detail: "Level 2 charger" }), defaultMessages)
		).toEqual({ kind: "detail", text: "Level 2 charger" });
		expect(levelText(item("1", "A", { level: NO_LEVEL, detail: "" }), defaultMessages)).toEqual({
			kind: "none",
			text: "No level"
		});
	});
});

describe("a category reading shows its level label once", () => {
	const format = createDefaultFormat();
	const smoke = (value: string) =>
		item("p", "Smoke", {
			value,
			level: smokeScale.levels.find((l) => l.value === value) ?? NO_LEVEL,
			units: ""
		});

	it("hides a value that is its category level's code", () => {
		expect(shownValue(smoke("light"), format)).toBeNull();
		const burn = item("b", "Kern", {
			value: burnScale.levels[0].value,
			level: burnScale.levels[0],
			units: ""
		});
		expect(shownValue(burn, format)).toBeNull();
	});

	it("hides a numeric category code too (the heat score's 0 to 4)", () => {
		const heat = item("z", "93721", { value: 2, level: heatScale.levels[2], units: "" });
		expect(shownValue(heat, format)).toBeNull();
	});

	it("keeps a category value that matches no level", () => {
		expect(shownValue(smoke("extreme"), format)).toBe("extreme");
	});

	it("keeps a number on a range scale", () => {
		expect(shownValue(item("1", "Arvin", { value: 12.34, precision: 1 }), format)).toBe("12.3");
	});

	it("reads the row as its name and level", () => {
		expect(rowLabel(smoke("light"), defaultMessages, format)).toBe("Smoke, Light");
		const heat = item("z", "93721", { value: 2, level: heatScale.levels[2], units: "" });
		expect(rowLabel(heat, defaultMessages, format)).toBe("93721, Moderate");
	});
});
