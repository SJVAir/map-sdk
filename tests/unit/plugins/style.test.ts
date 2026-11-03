import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { levelFor, NO_LEVEL } from "../../../src/lib/data/scale.js";
import {
	colorExpression,
	levelKeyExpression,
	NEUTRAL_COLOR_VAR,
	opacityExpression
} from "../../../src/lib/plugins/style.js";
import { burnScale, fireScale, heatScale, pm25Scale, smokeScale } from "../../fixtures/scales.js";

const NEUTRAL = "#888888";

/** The step input every range lookup uses (see `numeric` in style.ts). */
const numericValue = [
	"let",
	"v",
	["get", "value"],
	[
		"case",
		["==", ["typeof", ["var", "v"]], "number"],
		["to-number", ["var", "v"]],
		["==", ["typeof", ["var", "v"]], "string"],
		[
			"let",
			"n",
			["to-number", ["var", "v"], -1],
			[
				"case",
				["all", ["==", ["var", "n"], 0], ["!", ["in", "0", ["to-string", ["var", "v"]]]]],
				-1,
				["var", "n"]
			]
		],
		-1
	]
];

function evaluate(expr: unknown, value: unknown, type: "color" | "number" | "string" = "color") {
	const result = createExpression(expr, { type } as never);
	if (result.result !== "success") throw new Error(JSON.stringify(result.value));
	const props = value === undefined ? {} : { value };
	const out = result.value.evaluate({ zoom: 0 }, { type: 1, properties: props } as never);
	return type === "color" ? (out as { toString(): string }).toString() : out;
}

function colorOf(expr: unknown, value: unknown) {
	return evaluate(expr, value);
}

describe("NEUTRAL_COLOR_VAR", () => {
	it("names the muted token", () => {
		expect(NEUTRAL_COLOR_VAR).toBe("--muted");
	});
});

describe("colorExpression", () => {
	it("builds a step over to-number with each level min as a breakpoint", () => {
		const expr = colorExpression(pm25Scale, "value", NEUTRAL) as unknown[];
		expect(expr[0]).toBe("step");
		expect(expr[1]).toEqual(numericValue);
		expect(expr[2]).toBe(NEUTRAL);
		const mins = expr.slice(3).filter((_, i) => i % 2 === 0);
		expect(mins).toEqual(pm25Scale.levels.map((l) => l.min));
		const colors = expr.slice(3).filter((_, i) => i % 2 === 1);
		expect(colors).toEqual(pm25Scale.levels.map((l) => l.color));
	});

	it("matches levelFor at every pm25 boundary", () => {
		const expr = colorExpression(pm25Scale, "value", NEUTRAL);
		for (const level of pm25Scale.levels) {
			for (const v of [level.min!, level.max ?? level.min! + 1000]) {
				const found = levelFor(v, pm25Scale);
				const expected = found === NO_LEVEL ? NEUTRAL : found.color;
				expect(colorOf(expr, v)).toBe(colorOf(["literal", expected], undefined));
			}
		}
	});

	it("sends the boundary value to the next level", () => {
		const expr = colorExpression(pm25Scale, "value", NEUTRAL);
		expect(colorOf(expr, 9.1)).toBe(colorOf(["literal", "#ffff00"], undefined));
		expect(colorOf(expr, 9.0999)).toBe(colorOf(["literal", "#00e400"], undefined));
	});

	it("maps below-first, null, missing and non-numeric values to neutral", () => {
		const expr = colorExpression(pm25Scale, "value", NEUTRAL);
		const neutral = colorOf(["literal", NEUTRAL], undefined);
		for (const v of [-5, null, undefined, "abc"]) expect(colorOf(expr, v)).toBe(neutral);
	});

	it("maps blank strings, booleans and arrays to neutral, like levelFor", () => {
		const expr = colorExpression(pm25Scale, "value", NEUTRAL);
		const neutral = colorOf(["literal", NEUTRAL], undefined);
		for (const v of ["", " ", "\t"]) expect(levelFor(v, pm25Scale)).toBe(NO_LEVEL);
		for (const v of ["", " ", "\t", true, false, [5]]) expect(colorOf(expr, v)).toBe(neutral);
	});

	it("reads numeric strings as numbers, like levelFor", () => {
		const expr = colorExpression(pm25Scale, "value", NEUTRAL);
		for (const v of ["0", " 0 ", "0.0", "12", "9.1"]) {
			const found = levelFor(v, pm25Scale);
			expect(found).not.toBe(NO_LEVEL);
			expect(colorOf(expr, v)).toBe(
				colorOf(["literal", (found as { color: string }).color], undefined)
			);
		}
	});

	it("falls to neutral in a gap between levels", () => {
		const gapped = {
			...fireScale,
			levels: [
				{ ...fireScale.levels[0], min: 0, max: 5 },
				{ ...fireScale.levels[1], min: 10, max: null }
			]
		};
		const expr = colorExpression(gapped, "value", NEUTRAL);
		expect(colorOf(expr, 7)).toBe(colorOf(["literal", NEUTRAL], undefined));
		expect(colorOf(expr, 10)).toBe(colorOf(["literal", "#FF8C00"], undefined));
	});

	it("builds a match with a neutral default for category scales", () => {
		const expr = colorExpression(smokeScale, "value", NEUTRAL) as unknown[];
		expect(expr).toEqual([
			"match",
			["get", "value"],
			"light",
			"#bfc8c3",
			"medium",
			"#757b78",
			"heavy",
			"#333634",
			NEUTRAL
		]);
		expect(colorOf(expr, "nope")).toBe(colorOf(["literal", NEUTRAL], undefined));
		expect(colorOf(expr, null)).toBe(colorOf(["literal", NEUTRAL], undefined));
	});

	it("supports numeric category values", () => {
		const expr = colorExpression(heatScale, "value", NEUTRAL);
		expect(colorOf(expr, 3)).toBe(colorOf(["literal", "#c23a00"], undefined));
		expect(colorOf(expr, 9)).toBe(colorOf(["literal", NEUTRAL], undefined));
	});

	it("outputs neutral for a level with an empty color", () => {
		const expr = colorExpression(burnScale, "value", NEUTRAL) as unknown[];
		expect(expr).toEqual(["match", ["get", "value"], "discouraged", NEUTRAL, NEUTRAL]);
		const range = {
			...fireScale,
			levels: [{ ...fireScale.levels[0], color: "" }, fireScale.levels[1]]
		};
		const rexpr = colorExpression(range, "value", NEUTRAL);
		expect(colorOf(rexpr, 3)).toBe(colorOf(["literal", NEUTRAL], undefined));
	});
});

describe("opacityExpression", () => {
	it("matches level opacities and defaults to the fallback", () => {
		const expr = opacityExpression(smokeScale, "value", 0.6);
		expect(expr).toEqual([
			"match",
			["get", "value"],
			"light",
			0.2,
			"medium",
			0.3,
			"heavy",
			0.4,
			0.6
		]);
		expect(evaluate(expr, "medium", "number")).toBe(0.3);
		expect(evaluate(expr, "x", "number")).toBe(0.6);
	});

	it("returns the fallback number when no level has an opacity", () => {
		expect(opacityExpression(pm25Scale, "value", 0.6)).toBe(0.6);
	});

	it("steps over range scales and uses the fallback for uncovered values", () => {
		const scale = {
			...fireScale,
			levels: fireScale.levels.map((l, i) => ({ ...l, opacity: i === 0 ? null : 0.5 }))
		};
		const expr = opacityExpression(scale, "value", 0.9);
		expect(evaluate(expr, 5, "number")).toBe(0.9);
		expect(evaluate(expr, 10, "number")).toBe(0.5);
		expect(evaluate(expr, -1, "number")).toBe(0.9);
	});
});

describe("levelKeyExpression", () => {
	it("returns level keys, with an empty string where no level applies", () => {
		const expr = levelKeyExpression(pm25Scale, "value");
		expect(evaluate(expr, 9.1, "string")).toBe("moderate");
		expect(evaluate(expr, 9.0, "string")).toBe("good");
		expect(evaluate(expr, -2, "string")).toBe("");
		expect(evaluate(expr, null, "string")).toBe("");
		const cat = levelKeyExpression(smokeScale, "value");
		expect(evaluate(cat, "heavy", "string")).toBe("heavy");
		expect(evaluate(cat, "zzz", "string")).toBe("");
	});
});
