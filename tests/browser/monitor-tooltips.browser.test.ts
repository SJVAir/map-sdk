import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { FeatureListItem } from "../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../src/lib/data/format.js";
import { defaultMessages } from "../../src/lib/data/messages.js";
import type { MetadataProvider } from "../../src/lib/data/metadata.js";
import { NO_LEVEL } from "../../src/lib/data/scale.js";
import type { MonitorFeatureProperties } from "../../src/lib/data/types.js";
import type { ClusterInfo } from "../../src/lib/plugins/points.svelte.js";
import MonitorClusterTooltip from "../../src/lib/presets/MonitorClusterTooltip.svelte";
import MonitorTooltip from "../../src/lib/presets/MonitorTooltip.svelte";
import { monitor } from "../fixtures/monitors.js";
import { pm25Scale } from "../fixtures/scales.js";

const format = createDefaultFormat("America/Los_Angeles");

function item(value: FeatureListItem["value"]): FeatureListItem {
	return {
		refKey: "monitor:1",
		ref: { kind: "monitor", id: "1" },
		name: "Fresno Garland",
		value,
		level: value === null ? NO_LEVEL : pm25Scale.levels[1],
		units: "µg/m³",
		lngLat: [-119.7, 36.7],
		selectable: true
	};
}

describe("MonitorTooltip", () => {
	it("shows the rounded reading in a box with the scale's label, the time, and the level", async () => {
		render(MonitorTooltip, {
			item: item(12.6),
			timestamp: "2026-11-03T21:00:00Z",
			scale: pm25Scale,
			messages: defaultMessages,
			format
		});
		const text = document.body.textContent!.replace(/\s+/g, " ");
		expect(text).toContain("PM2.5 13");
		expect(text).toContain("Nov 3, 2026, 1:00 PM");
		expect(text).toContain("Moderate");
		expect(text).toMatch(/Last updated \d+ (minutes|hours|days?) ago/);
		const box = page.getByText("13").element().parentElement!;
		expect(getComputedStyle(box).backgroundColor).toBe("rgb(255, 255, 0)");
		expect(getComputedStyle(box).color).toBe("rgb(0, 0, 0)");
	});

	it("shows no reading and No level in a neutral box", async () => {
		render(MonitorTooltip, {
			item: item(null),
			timestamp: null,
			scale: pm25Scale,
			messages: defaultMessages,
			format
		});
		await expect.element(page.getByText("No reading")).toBeVisible();
		await expect.element(page.getByText("No level")).toBeVisible();
	});
});

describe("MonitorClusterTooltip", () => {
	function cluster(rows: MonitorFeatureProperties[], coords: Array<[number, number]>) {
		const info: ClusterInfo<MonitorFeatureProperties> = {
			group: "purpleair",
			pointCount: rows.length,
			properties: {},
			leaves: async () => rows.map((props, i) => ({ props, lngLat: coords[i] }))
		};
		return info;
	}

	const metadata = {
		monitorTypeLabel: vi.fn(async () => "PurpleAir")
	} as unknown as MetadataProvider;

	it("shows the type, count, area, average, max, and min with units", async () => {
		render(MonitorClusterTooltip, {
			cluster: cluster(
				[
					monitor("1", "purpleair", 10, { isSjvair: true }),
					monitor("2", "purpleair", 20),
					monitor("3", "purpleair", null)
				],
				[
					[-119.7, 36.7],
					[-119.6, 36.7],
					[-119.6, 36.8]
				]
			),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata
		});
		await expect.element(page.getByText("SJVAir PurpleAir Monitors")).toBeVisible();
		const text = document.body.textContent!.replace(/\s+/g, " ");
		expect(text).toMatch(/3 monitors covering \d+\.\d{3} mi²/);
		expect(text).toContain("PM2.5 15 (cluster avg)");
		expect(text).toContain("Moderate");
		expect(text).toContain("Max: 20 µg/m³");
		expect(text).toContain("Min: 10 µg/m³");
	});

	it("leaves out the area for two monitors and falls back to the type id", async () => {
		const unavailable = {
			monitorTypeLabel: vi.fn(async () => "unavailable")
		} as unknown as MetadataProvider;
		render(MonitorClusterTooltip, {
			cluster: cluster(
				[monitor("1", "purpleair", 10), monitor("2", "purpleair", 30)],
				[
					[-119.7, 36.7],
					[-119.6, 36.7]
				]
			),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata: unavailable
		});
		await expect.element(page.getByText("purpleair Monitors")).toBeVisible();
		await expect.element(page.getByText("2 monitors", { exact: true })).toBeVisible();
	});
});
