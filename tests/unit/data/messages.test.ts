import { describe, expect, it } from "vitest";
import en from "../../../src/lib/data/messages/en.json";
import { defaultMessages } from "../../../src/lib/data/messages.js";

describe("message catalog", () => {
	it("prefixes every key with mapsdk_", () => {
		const keys = Object.keys(en).filter((k) => k !== "$schema");
		expect(keys.length).toBeGreaterThan(0);
		for (const key of keys) expect(key.startsWith("mapsdk_")).toBe(true);
	});

	it("interpolates params", () => {
		expect(
			defaultMessages("mapsdk_list_row", {
				name: "A",
				value: "38",
				units: "µg/m³",
				level: "Moderate"
			})
		).toBe("A, 38 µg/m³, Moderate");
	});

	it("picks plural variants from the base key and count", () => {
		expect(defaultMessages("mapsdk_selected_count", { count: 1 })).toBe("1 selected");
		expect(defaultMessages("mapsdk_selected_count", { count: 3 })).toBe("3 selected");
		expect(defaultMessages("mapsdk_summary", { count: 1, layer: "monitor" })).toBe("1 monitor");
	});

	it("leaves missing params in place without throwing", () => {
		expect(defaultMessages("mapsdk_list_row_no_value", {})).toBe("{name}, no reading");
		expect(defaultMessages("mapsdk_list_row_no_value")).toBe("{name}, no reading");
	});
});
