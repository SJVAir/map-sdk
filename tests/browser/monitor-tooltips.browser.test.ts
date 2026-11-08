import area from "@turf/area";
import { convertArea, polygon } from "@turf/helpers";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { FeatureListItem } from "../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../src/lib/data/format.js";
import { defaultMessages } from "../../src/lib/data/messages.js";
import type { MetadataProvider } from "../../src/lib/data/metadata.js";
import { NO_LEVEL } from "../../src/lib/data/scale.js";
import type {
	CollocationFeatureProperties,
	MonitorFeatureProperties
} from "../../src/lib/data/types.js";
import type { ClusterInfo } from "../../src/lib/plugins/points.svelte.js";
import CollocationTooltip from "../../src/lib/presets/CollocationTooltip.svelte";
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
	it("shows the whole-number reading in a box with the scale's label, the time, and the level", async () => {
		render(MonitorTooltip, {
			item: item(12.6),
			timestamp: "2026-11-03T21:00:00Z",
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			interval: null
		});
		const text = document.body.textContent!.replace(/\s+/g, " ");
		expect(text).toContain("PM2.5 12");
		expect(text).toContain("Fresno Garland");
		expect(text).toContain("1:00 pm Tuesday Nov 03, 2026");
		expect(text).toContain("Moderate");
		expect(text).toMatch(/Last updated \d+ (minutes|hours|days?) ago/);
		const box = page.getByText("12").element().parentElement!;
		expect(getComputedStyle(box).backgroundColor).toBe("rgb(255, 255, 0)");
		expect(getComputedStyle(box).color).toBe("rgb(0, 0, 0)");
	});

	it("adds PT after the time on a device outside Pacific", async () => {
		render(MonitorTooltip, {
			item: item(12.6),
			timestamp: "2026-07-01T19:30:00Z",
			scale: pm25Scale,
			messages: defaultMessages,
			format: createDefaultFormat("America/New_York"),
			interval: null
		});
		expect(document.body.textContent).toContain("12:30 pm Wednesday Jul 01, 2026 PT");
	});

	it("shows a whole number whatever the item's precision, as monitor-map does", async () => {
		render(MonitorTooltip, {
			item: { ...item(12.64), precision: 1 },
			timestamp: null,
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			interval: null
		});
		expect(document.body.textContent!.replace(/\s+/g, " ")).toContain("PM2.5 12");
		expect(document.body.textContent).not.toContain("12.6");
	});

	it("cuts the reading off like monitor-map: 9.3 shows 9 in Moderate's color and label", async () => {
		render(MonitorTooltip, {
			item: { ...item(9.3), level: pm25Scale.levels[1] },
			timestamp: null,
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			interval: null
		});
		expect(document.body.textContent!.replace(/\s+/g, " ")).toContain("PM2.5 9");
		expect(document.body.textContent).toContain("Moderate");
		const box = page.getByText("9", { exact: true }).element().parentElement!;
		expect(getComputedStyle(box).backgroundColor).toBe("rgb(255, 255, 0)");
	});

	it("lays out the box left; time, bold underlined name, level, then the age on the right", async () => {
		render(MonitorTooltip, {
			item: item(12.6),
			timestamp: "2026-11-03T21:00:00Z",
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			interval: null
		});
		const detail = document.querySelector(".mapsdk-monitor-detail")!;
		const texts = [...detail.children].map((c) => c.textContent!.trim());
		expect(texts[0]).toContain("Tuesday Nov 03, 2026");
		expect(texts[1]).toBe("Fresno Garland");
		expect(texts[2]).toBe("Moderate");
		expect(texts[3]).toMatch(/^Last updated/);
		const name = getComputedStyle(detail.children[1]);
		expect(name.fontWeight).toBe("700");
		expect(name.textDecorationLine).toBe("underline");
		const box = document.querySelector(".mapsdk-reading-box")!;
		expect(box.getBoundingClientRect().right).toBeLessThanOrEqual(
			detail.getBoundingClientRect().left
		);
	});

	it("shows no reading and No level in a neutral box", async () => {
		render(MonitorTooltip, {
			item: item(null),
			timestamp: null,
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			interval: null
		});
		await expect.element(page.getByText("No reading")).toBeVisible();
		await expect.element(page.getByText("No level")).toBeVisible();
	});
});

describe("MonitorTooltip interval note", () => {
	it("monitor tooltip shows (1 hour avg) for airnow", async () => {
		render(MonitorTooltip, {
			item: item(12.6),
			timestamp: null,
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			interval: "1 hour"
		});
		await expect.element(page.getByText("(1 hour avg)")).toBeVisible();
	});

	it("no note when the provider lacks monitorTypeInterval", async () => {
		render(MonitorTooltip, {
			item: item(12.6),
			timestamp: null,
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			interval: null
		});
		expect(document.body.textContent).not.toContain("avg)");
	});
});

describe("MonitorTooltip with an empty-color level", () => {
	it("shows the level's label in a neutral box", async () => {
		const unknown = { ...pm25Scale.levels[1], label: "Unknown", color: "" };
		render(MonitorTooltip, {
			item: { ...item(12.6), level: unknown },
			timestamp: null,
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			interval: null
		});
		await expect.element(page.getByText("Unknown")).toBeVisible();
		expect(page.getByText("No level").elements()).toHaveLength(0);
		const box = page.getByText("12").element().parentElement!;
		expect(getComputedStyle(box).backgroundColor).not.toBe("rgb(255, 255, 0)");
	});
});

describe("MonitorClusterTooltip", () => {
	/** A cluster whose bubble properties carry the readings' sum and count, as MapLibre's do. */
	function cluster(
		rows: MonitorFeatureProperties[],
		coords: Array<[number, number]>,
		leaves?: ClusterInfo<MonitorFeatureProperties>["leaves"]
	) {
		const readings = rows.flatMap((r) => (typeof r.value === "number" ? [r.value] : []));
		const info: ClusterInfo<MonitorFeatureProperties> = {
			group: "purpleair",
			pointCount: rows.length,
			properties: {
				point_count: rows.length,
				sumValues: readings.reduce((a, b) => a + b, 0),
				countValues: readings.length
			},
			leaves: leaves ?? (async () => rows.map((props, i) => ({ props, lngLat: coords[i] })))
		};
		return info;
	}

	const rows = [monitor("1", "purpleair", 10), monitor("2", "purpleair", 30)];
	const coords: Array<[number, number]> = [
		[-119.7, 36.7],
		[-119.6, 36.7]
	];

	it("shows the bubble's count and average while the leaves load", async () => {
		render(MonitorClusterTooltip, {
			cluster: cluster(rows, coords, () => new Promise(() => {})),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata
		});
		await expect.element(page.getByText("2 monitors", { exact: true })).toBeVisible();
		const text = document.body.textContent!.replace(/\s+/g, " ");
		expect(text).toContain("PM2.5 20 (cluster avg)");
		expect(text).toContain("Moderate");
	});

	it("takes the level from the unrounded average, as the bubble does", async () => {
		// 9.12 rounds to 9 (Good), but is Moderate (from 9.1) like the bubble's color.
		const near = [monitor("1", "purpleair", 9.1), monitor("2", "purpleair", 9.14)];
		render(MonitorClusterTooltip, {
			cluster: cluster(near, coords, () => new Promise(() => {})),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata
		});
		await expect.element(page.getByText("2 monitors", { exact: true })).toBeVisible();
		const text = document.body.textContent!.replace(/\s+/g, " ");
		expect(text).toContain("PM2.5 9 (cluster avg)");
		expect(text).toContain("Moderate");
		expect(text).not.toContain("Good");
	});

	it("rounds the average to a whole number and shows max and min as reported", async () => {
		const near = [monitor("1", "purpleair", 8.02), monitor("2", "purpleair", 24.93)];
		render(MonitorClusterTooltip, {
			cluster: cluster(near, coords),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata
		});
		await expect.element(page.getByText(/^Max:/)).toBeVisible();
		const text = document.body.textContent!.replace(/\s+/g, " ");
		expect(text).toContain("PM2.5 16 (cluster avg)");
		expect(text).toContain("Max: 24.93 µg/m³");
		expect(text).toContain("Min: 8.02 µg/m³");
	});

	it("keeps the bubble's count and average when the leaves fail", async () => {
		render(MonitorClusterTooltip, {
			cluster: cluster(rows, coords, () => Promise.reject(new Error("gone"))),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata
		});
		await expect.element(page.getByText("PurpleAir Monitors")).toBeVisible();
		await expect.element(page.getByText("2 monitors", { exact: true })).toBeVisible();
		expect(document.body.textContent).toContain("20");
		expect(document.body.textContent).not.toContain("Max:");
	});

	const metadata = {
		monitorTypeLabel: vi.fn(async () => "PurpleAir")
	} as unknown as MetadataProvider;

	it("shows the type, count, average, max, and min with units", async () => {
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
		const tri: Array<[number, number]> = [
			[-119.7, 36.7],
			[-119.6, 36.7],
			[-119.6, 36.8]
		];
		const expected = convertArea(area(polygon([[...tri, tri[0]]])), "meters", "miles").toFixed(3);
		expect(text).toContain(`3 monitors within a ${expected} mi² area`);
		expect(text).not.toContain("covering");
		expect(text).toContain("PM2.5 15 (cluster avg)");
		expect(text).toContain("Moderate");
		expect(text).toContain("Max: 20 µg/m³");
		expect(text).toContain("Min: 10 µg/m³");
	});

	it("collinear leaves show just the count", async () => {
		const three = [1, 2, 3].map((n) => monitor(String(n), "purpleair", 10));
		render(MonitorClusterTooltip, {
			cluster: cluster(three, [
				[-119.7, 36.7],
				[-119.6, 36.7],
				[-119.5, 36.7]
			]),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata
		});
		await expect.element(page.getByText(/^Max:/)).toBeVisible();
		await expect.element(page.getByText("3 monitors", { exact: true })).toBeVisible();
		expect(document.body.textContent).not.toContain("within");
	});

	it("leaves a few metres apart show just the count", async () => {
		const three = [1, 2, 3].map((n) => monitor(String(n), "purpleair", 10));
		render(MonitorClusterTooltip, {
			cluster: cluster(three, [
				[-119.7, 36.7],
				[-119.70001, 36.7],
				[-119.7, 36.70001]
			]),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata
		});
		await expect.element(page.getByText(/^Max:/)).toBeVisible();
		await expect.element(page.getByText("3 monitors", { exact: true })).toBeVisible();
		expect(document.body.textContent).not.toContain("within");
	});

	it("the area belongs to the current cluster", async () => {
		const three = [1, 2, 3].map((n) => monitor(String(n), "purpleair", 10));
		const tri: Array<[number, number]> = [
			[-119.7, 36.7],
			[-119.6, 36.7],
			[-119.6, 36.8]
		];
		const screen = await render(MonitorClusterTooltip, {
			cluster: cluster(three, tri),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			metadata
		});
		await expect.element(page.getByText(/within a/)).toBeVisible();
		await screen.rerender({ cluster: cluster(three, tri, () => new Promise(() => {})) });
		await expect.element(page.getByText("3 monitors", { exact: true })).toBeVisible();
		expect(document.body.textContent).not.toContain("within");
	});

	it("falls back to the type id", async () => {
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

describe("CollocationTooltip", () => {
	const site = (
		extra: Partial<CollocationFeatureProperties> = {}
	): CollocationFeatureProperties => ({
		...monitor("ref", "airnow", 12.6, {
			name: "Fresno Garland",
			timestamp: "2026-11-03T21:00:00Z"
		}),
		refKey: "feature:s1",
		referenceName: "Garland Reference",
		colocatedId: "col",
		colocatedName: "Garland PurpleAir",
		colocatedType: "purpleair",
		colocatedValue: 40.2,
		colocatedTimestamp: "2026-11-03T21:02:00Z",
		...extra
	});

	it("collocation tooltip shows both readings", async () => {
		render(CollocationTooltip, {
			site: site(),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			referenceInterval: "1 hour",
			colocatedInterval: "2 min"
		});
		const text = document.body.textContent!.replace(/\s+/g, " ");
		expect(text).toContain("PM2.5 12 (1 hour avg)");
		expect(text).toContain("PM2.5 40 (2 min avg)");
		expect(text).toContain("1:00 pm Tuesday Nov 03, 2026");
		expect(text).toContain("1:02 pm Tuesday Nov 03, 2026");
		// The reference monitor's own name, not the site's.
		expect(text).toContain("Garland Reference");
		expect(text).not.toContain("Fresno Garland");
		expect(text).toContain("Garland PurpleAir");
		expect(text).toContain("Reference monitor");
		expect(text).toContain("Collocated monitor");
		expect(text).toContain("Moderate");
		expect(text).toContain("Unhealthy for Sensitive Groups");
		expect(text.match(/Last updated \d+ (minutes|hours|days?) ago/g)).toHaveLength(2);
		const reference = page.getByText("12").element().parentElement!;
		expect(getComputedStyle(reference).backgroundColor).toBe("rgb(255, 255, 0)");
		const colocated = page.getByText("40").element().parentElement!;
		expect(getComputedStyle(colocated).backgroundColor).toBe("rgb(255, 126, 0)");
		// The collocated row puts its box on the other side, as monitor-map does.
		const rows = document.querySelectorAll(".mapsdk-collocation-row");
		expect(getComputedStyle(rows[0]).flexDirection).toBe("row");
		expect(getComputedStyle(rows[1]).flexDirection).toBe("row-reverse");
	});

	it("falls back to the site name without a reference monitor name", async () => {
		render(CollocationTooltip, {
			site: site({ referenceName: null }),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			referenceInterval: null,
			colocatedInterval: null
		});
		await expect.element(page.getByText("Fresno Garland")).toBeVisible();
	});

	it("a missing monitor shows No reading and No level in a neutral box", async () => {
		render(CollocationTooltip, {
			site: site({
				colocatedName: null,
				colocatedType: null,
				colocatedValue: null,
				colocatedTimestamp: null
			}),
			scale: pm25Scale,
			messages: defaultMessages,
			format,
			referenceInterval: null,
			colocatedInterval: null
		});
		await expect.element(page.getByText("No reading")).toBeVisible();
		await expect.element(page.getByText("No level")).toBeVisible();
		await expect.element(page.getByText("Collocated monitor")).toBeVisible();
		expect(document.body.textContent).not.toContain("avg)");
		expect(document.body.textContent!.match(/Last updated/g)).toHaveLength(1);
	});
});
