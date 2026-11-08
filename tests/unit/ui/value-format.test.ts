import { describe, expect, it } from "vitest";
import { createDefaultFormat } from "../../../src/lib/data/format.js";
import { formatValue } from "../../../src/lib/ui/value-format.js";

describe("formatValue", () => {
	const format = createDefaultFormat("America/Los_Angeles");

	it("rounds by default", () => {
		expect(formatValue(9.96, 1, format)).toBe("10.0");
	});

	it("cuts off when asked, so the number never reads as the next level", () => {
		expect(formatValue(9.96, 1, format, true)).toBe("9.9");
		expect(formatValue(412, 1, format, true)).toBe("412.0");
		expect(formatValue(0.7, 1, format, true)).toBe("0.7");
	});

	it("cuts off without floating-point error", () => {
		expect(formatValue(4.35, 2, format, true)).toBe("4.35");
		expect(formatValue(1.15, 2, format, true)).toBe("1.15");
	});

	it("without a precision, truncate changes nothing", () => {
		expect(formatValue(9.96, undefined, format, true)).toBe(format.number(9.96));
	});
});
