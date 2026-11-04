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

	describe("relativeTime", () => {
		const now = new Date("2026-11-03T21:00:00Z");

		it("counts minutes under an hour", () => {
			expect(format.relativeTime("2026-11-03T20:55:00Z", now)).toBe("5 minutes ago");
			expect(format.relativeTime(new Date("2026-11-03T20:59:40Z"), now)).toBe("0 minutes ago");
		});

		it("counts hours under a day", () => {
			expect(format.relativeTime("2026-11-03T19:00:00Z", now)).toBe("2 hours ago");
			expect(format.relativeTime("2026-11-02T22:00:00Z", now)).toBe("23 hours ago");
		});

		it("counts days from a day", () => {
			expect(format.relativeTime("2026-11-02T21:00:00Z", now)).toBe("1 day ago");
			expect(format.relativeTime("2026-10-24T21:00:00Z", now)).toBe("10 days ago");
		});

		it("says in for a future time", () => {
			expect(format.relativeTime("2026-11-03T21:30:00Z", now)).toBe("in 30 minutes");
		});

		it("defaults now to the current time", () => {
			expect(format.relativeTime(new Date(Date.now() - 3 * 60_000))).toBe("3 minutes ago");
		});
	});
});
