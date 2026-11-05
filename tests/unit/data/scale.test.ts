import { describe, expect, it } from "vitest";
import { NO_LEVEL, levelFor, numericValue } from "../../../src/lib/data/scale.js";
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
		expect(keyOf(10, fireScale)).toBe("md");
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
