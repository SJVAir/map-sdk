import { describe, expect, it } from "vitest";
import type { FeatureListItem } from "../../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../../src/lib/data/format.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";
import type { Level } from "../../../src/lib/data/scale-types.js";
import {
	inView,
	optionIdPart,
	rowLabel,
	sortItems,
	typeaheadIndex
} from "../../../src/lib/ui/feature-list.js";

function level(label: string, tier: number, color = "#00e400"): Level {
	return { key: label, label, color, opacity: null, tier, description: "", guidance: "" };
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

	it("says No level for a value without one, or a level with no color", () => {
		expect(rowLabel(item("1", "A", { value: -3, level: NO_LEVEL }), defaultMessages, format)).toBe(
			"A, -3 µg/m³, No level"
		);
		expect(
			rowLabel(item("1", "B", { value: 5, level: level("Broken", 0, "") }), defaultMessages, format)
		).toBe("B, 5 µg/m³, No level");
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
