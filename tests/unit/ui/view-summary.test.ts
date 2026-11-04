import { describe, expect, it } from "vitest";
import type { FeatureListItem } from "../../../src/lib/core/plugin.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";
import type { Level } from "../../../src/lib/data/scale-types.js";
import { summaryText } from "../../../src/lib/ui/view-summary.js";
import { pm25Scale } from "../../fixtures/scales.js";

function item(i: number, level: Level | typeof NO_LEVEL): FeatureListItem {
	return {
		refKey: `monitor:${i}`,
		ref: { kind: "monitor", id: String(i) },
		name: `M${i}`,
		value: 1,
		level,
		units: "µg/m³",
		lngLat: [-119.5, 36.5],
		selectable: true
	};
}

const [good, moderate, , unhealthy] = pm25Scale.levels;
const many = (n: number, level: Level | typeof NO_LEVEL, from = 0) =>
	Array.from({ length: n }, (_, i) => item(from + i, level));

describe("summaryText", () => {
	it("counts per level in scale order and leaves out zero counts", () => {
		const items = [...many(3, unhealthy), ...many(20, moderate, 10)];
		expect(summaryText("monitors", items, pm25Scale, defaultMessages)).toBe(
			"monitors: 20 Moderate, 3 Unhealthy"
		);
	});

	it("joins three or more counts as a unit list", () => {
		const items = [...many(1, good), ...many(2, moderate, 5), ...many(3, unhealthy, 10)];
		expect(summaryText("monitors", items, pm25Scale, defaultMessages)).toBe(
			"monitors: 1 Good, 2 Moderate, 3 Unhealthy"
		);
	});

	it("puts items with no level last", () => {
		const items = [...many(2, NO_LEVEL), ...many(1, good, 5)];
		expect(summaryText("monitors", items, pm25Scale, defaultMessages)).toBe(
			"monitors: 1 Good, 2 No level"
		);
	});

	it("counts an empty-color level under its own label", () => {
		const unknown: Level = { ...good, key: "unknown", label: "Unknown", color: "" };
		const scale = { ...pm25Scale, levels: [...pm25Scale.levels, unknown] };
		const items = [...many(2, unknown), ...many(1, good, 5), ...many(1, NO_LEVEL, 9)];
		expect(summaryText("monitors", items, scale, defaultMessages)).toBe(
			"monitors: 1 Good, 2 Unknown, 1 No level"
		);
	});

	it("gives only the count when there is no scale or nothing is listed", () => {
		expect(summaryText("monitors", many(4, good), null, defaultMessages)).toBe("4 monitors");
		expect(summaryText("monitors", [], pm25Scale, defaultMessages)).toBe("0 monitors");
	});
});
