import { describe, expect, it } from "vitest";
import {
	NO_LEVEL,
	levelFor,
	numericValue,
	scaleFromLegacyLevels
} from "../../../src/lib/data/scale.js";
import { fireScale, heatScale, pm25Scale, smokeScale } from "../../fixtures/scales.js";

function keyOf(value: Parameters<typeof levelFor>[0], scale = pm25Scale) {
	const level = levelFor(value, scale);
	return level === NO_LEVEL ? NO_LEVEL : level.key;
}

describe("levelFor", () => {
	it("finds range levels", () => {
		expect(keyOf(0)).toBe("good");
		expect(keyOf(20)).toBe("moderate");
	});

	it("puts a value equal to a level's max in the next level", () => {
		expect(keyOf(9.1)).toBe("moderate");
		expect(keyOf(35.5)).toBe("unhealthy_sensitive");
		expect(keyOf(10, fireScale)).toBe("10-49");
	});

	it("uses the top level for large values", () => {
		expect(keyOf(1000)).toBe("hazardous");
	});

	it("returns NO_LEVEL for values outside or not numeric", () => {
		expect(keyOf(-1)).toBe(NO_LEVEL);
		expect(keyOf(null)).toBe(NO_LEVEL);
		expect(keyOf(undefined)).toBe(NO_LEVEL);
		expect(keyOf(NaN)).toBe(NO_LEVEL);
		expect(keyOf(Infinity)).toBe(NO_LEVEL);
		expect(keyOf("abc")).toBe(NO_LEVEL);
		expect(keyOf("")).toBe(NO_LEVEL);
	});

	it("coerces numeric strings for range scales", () => {
		expect(keyOf("20")).toBe("moderate");
	});

	it("matches category values", () => {
		expect(levelFor("heavy", smokeScale)).toMatchObject({ opacity: 0.4 });
		expect(keyOf("unknown", smokeScale)).toBe(NO_LEVEL);
		expect(keyOf(null, smokeScale)).toBe(NO_LEVEL);
		expect(levelFor(2, heatScale)).toMatchObject({ value: 2, key: "moderate" });
	});

	it("does not coerce strings for category scales", () => {
		expect(keyOf("2", heatScale)).toBe(NO_LEVEL);
	});
});

describe("scaleFromLegacyLevels", () => {
	const scale = scaleFromLegacyLevels("pm25", "PM2.5", "µg/m³", [
		{ name: "Good", label: "Good", color: "#00e400", range: [0, 9], guidance: null },
		{ name: "Moderate", label: "Moderate", color: "#ffff00", range: [9.1, 35.4], guidance: "Hi" },
		{ name: "Hazardous", label: "Hazardous", color: "#7e0023", range: [35.5, 99999], guidance: "X" }
	]);

	it("builds half-open range levels", () => {
		expect(scale).toMatchObject({ id: "pm25", label: "PM2.5", units: "µg/m³", kind: "range" });
		expect(scale.levels.map((l) => [l.min, l.max])).toEqual([
			[0, 9.1],
			[9.1, 35.5],
			[35.5, null]
		]);
	});

	it("lowercases keys and nulls tier and opacity", () => {
		expect(scale.levels.map((l) => l.key)).toEqual(["good", "moderate", "hazardous"]);
		for (const l of scale.levels) {
			expect(l.tier).toBeNull();
			expect(l.opacity).toBeNull();
		}
		expect(scale.levels[0].guidance).toBe("");
		expect(scale.levels[1].guidance).toBe("Hi");
	});

	it("works with levelFor", () => {
		expect(keyOf(9.05, scale)).toBe("good");
		expect(keyOf(9.1, scale)).toBe("moderate");
		expect(keyOf(500, scale)).toBe("hazardous");
	});
});

describe("numericValue", () => {
	it("reads numbers and non-blank numeric strings, as levelFor does", () => {
		expect(numericValue(12)).toBe(12);
		expect(numericValue("12.5")).toBe(12.5);
		expect(numericValue(" 7 ")).toBe(7);
		expect(numericValue("0")).toBe(0);
		expect(numericValue("-1")).toBe(-1);
	});

	it("is null for everything else", () => {
		for (const value of [null, undefined, "", " ", "abc", "Infinity", true, [1], Number.NaN]) {
			expect(numericValue(value as never), String(value)).toBeNull();
		}
	});
});
