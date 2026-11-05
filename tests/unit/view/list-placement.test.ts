import { describe, expect, it } from "vitest";
import { cornerSides, resolveFeatureList } from "../../../src/lib/view/list-placement.js";

describe("resolveFeatureList", () => {
	it.each([undefined, true, {}])("defaults %s to top-left, always shown", (value) => {
		expect(resolveFeatureList(value)).toEqual({ position: "top-left", reveal: "always" });
	});

	it("is null when the list is off", () => {
		expect(resolveFeatureList(false)).toBeNull();
	});

	it("keeps the options it's given", () => {
		expect(resolveFeatureList({ position: "top-right", reveal: "focus" })).toEqual({
			position: "top-right",
			reveal: "focus"
		});
		expect(resolveFeatureList({ reveal: "focus" })).toEqual({
			position: "top-left",
			reveal: "focus"
		});
	});
});

describe("cornerSides", () => {
	it.each([
		["top-left", { vertical: "top", horizontal: "left", far: "bottom-left" }],
		["top-right", { vertical: "top", horizontal: "right", far: "bottom-right" }],
		["bottom-left", { vertical: "bottom", horizontal: "left", far: "top-left" }],
		["bottom-right", { vertical: "bottom", horizontal: "right", far: "top-right" }]
	] as const)("describes %s", (position, sides) => {
		expect(cornerSides(position)).toEqual(sides);
	});
});
