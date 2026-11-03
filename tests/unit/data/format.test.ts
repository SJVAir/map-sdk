import { describe, expect, it } from "vitest";
import { createDefaultFormat } from "../../../src/lib/data/format.js";

describe("default format", () => {
	const format = createDefaultFormat("America/Los_Angeles");

	it("shows summer instants in Pacific daylight time", () => {
		expect(format.dateTime("2026-07-01T19:30:00Z")).toContain("12:30 PM");
	});

	it("shows winter instants in Pacific standard time", () => {
		expect(format.dateTime(new Date("2026-01-15T20:30:00Z"))).toContain("12:30 PM");
	});

	it("labels the zone only when the device isn't Pacific", () => {
		expect(format.zoneLabel()).toBeNull();
		expect(createDefaultFormat("America/New_York").zoneLabel()).toBe("PT");
	});

	it("formats numbers", () => {
		expect(format.number(38.25, { maximumFractionDigits: 1 })).toBe("38.3");
	});
});
