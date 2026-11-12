import { describe, expect, it } from "vitest";
import {
	badgeKindOf,
	schoolBubble,
	SCHOOL_BADGE_SIZE,
	schoolBadge,
	schoolBadgeMarkup
} from "../../../src/lib/presets/school-icons.js";

const PENTAGON = "M12 1.5 L22.5 9.5 V22.5 H1.5 V9.5 Z";

describe("badgeKindOf", () => {
	it("gives child-care for child_care and school for the rest", () => {
		expect(badgeKindOf("child_care")).toBe("child-care");
		expect(badgeKindOf("public_school")).toBe("school");
		expect(badgeKindOf("private_school")).toBe("school");
		expect(badgeKindOf("charter")).toBe("school");
	});
});

describe("schoolBadge", () => {
	it("draws the school glyph in a 20px school-house badge", () => {
		expect(SCHOOL_BADGE_SIZE).toBe(20);
		const svg = schoolBadge("school", "#5a6b7b");
		expect(svg).toContain('width="20"');
		expect(svg).toContain('height="20"');
		expect(svg).toContain(`d="${PENTAGON}"`);
		expect(svg).toContain('fill="#5a6b7b"');
		expect(svg).toContain('stroke="#ffffff"');
		expect(svg).toContain('d="M14 21v-3a2 2 0 0 0-4 0v3"');
		expect(svg).toContain('cx="12" cy="9" r="2"');
		expect(svg.match(/<(path|circle) /g)).toHaveLength(2 + 6);
	});

	it("draws the baby glyph for child care", () => {
		const svg = schoolBadge("child-care", "#1c9099");
		expect(svg).toContain('d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"');
		expect(svg).toContain('d="M9 12h.01"');
		expect(svg.match(/<(path|circle) /g)).toHaveLength(2 + 4);
	});

	it("parses as SVG", () => {
		expect(schoolBadge("school", "#000")).toMatch(
			/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/
		);
	});
});

describe("schoolBadgeMarkup", () => {
	it("fills from the token with its fixed fallback, and hides from screen readers", () => {
		const markup = schoolBadgeMarkup("child-care", 16);
		expect(markup).toContain("var(--child-care-marker, #1c9099)");
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).toContain('focusable="false"');
		expect(markup).toContain('width="16"');
		expect(schoolBadgeMarkup("school", 16)).toContain("var(--school-marker, #5a6b7b)");
	});
});

describe("schoolBubble", () => {
	it("is the school-house outline with no glyph, room for a count", () => {
		const svg = schoolBubble("#5a6b7b");
		expect(svg).toContain(`d="${PENTAGON}"`);
		expect(svg).toContain('fill="#5a6b7b"');
		expect(svg.match(/<(path|circle) /g)).toHaveLength(2);
	});
});
