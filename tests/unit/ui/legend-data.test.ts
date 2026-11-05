import { describe, expect, it } from "vitest";
import { createDefaultFormat } from "../../../src/lib/data/format.js";
import { legendSection, swatchOverBackground } from "../../../src/lib/ui/legend-data.js";
import { burnScale, pm25Scale, smokeScale } from "../../fixtures/scales.js";

const format = createDefaultFormat();

describe("legendSection", () => {
	it("makes a gradient with a floored tick per level for a range scale", () => {
		const section = legendSection(
			{ pluginId: "points", title: "PM2.5", units: "µg/m³", scale: pm25Scale },
			format
		);
		expect(section).toMatchObject({ pluginId: "points", title: "PM2.5", units: "µg/m³" });
		expect(section?.bar.kind).toBe("gradient");
		if (section?.bar.kind !== "gradient") return;
		expect(section.bar.stops).toHaveLength(6);
		expect(section.bar.stops.map((s) => s.tick)).toEqual(["0", "9", "35", "55", "125", "225"]);
		expect(section.bar.stops[1]).toEqual({ color: "#ffff00", label: "Moderate", tick: "9" });
	});

	it("makes blocks with opacities for a category scale", () => {
		const section = legendSection(
			{ pluginId: "shapes", title: "Smoke", units: "", scale: smokeScale },
			format
		);
		expect(section?.bar).toEqual({
			kind: "blocks",
			blocks: [
				{ color: "#bfc8c3", opacity: 0.2, label: "Light", tick: "" },
				{ color: "#757b78", opacity: 0.3, label: "Medium", tick: "" },
				{ color: "#333634", opacity: 0.4, label: "Heavy", tick: "" }
			]
		});
	});

	it("returns null for status-only data", () => {
		expect(
			legendSection({ pluginId: "points", status: { state: "loading" } } as never, format)
		).toBe(null);
	});

	it("keeps an empty color as is", () => {
		const section = legendSection(
			{ pluginId: "burn", title: "Burn", units: "", scale: burnScale },
			format
		);
		expect(section?.bar).toMatchObject({ blocks: [{ color: "", opacity: null }] });
	});
});

describe("swatchOverBackground", () => {
	it("mixes the color over the background by opacity", () => {
		expect(swatchOverBackground("#000000", 0.5, "#ffffff")).toBe("rgba(128, 128, 128, 1)");
		expect(swatchOverBackground("#000000", 0.5, "#000000")).toBe("rgba(0, 0, 0, 1)");
	});

	it("returns the color for no opacity or an empty color", () => {
		expect(swatchOverBackground("#ff0000", null, "#ffffff")).toBe("#ff0000");
		expect(swatchOverBackground("", 0.5, "#ffffff")).toBe("");
	});

	it("range scale with display blocks gives blocks with level labels", () => {
		const section = legendSection(
			{ pluginId: "points", title: "PM2.5", units: "µg/m³", scale: pm25Scale, display: "blocks" },
			format
		);
		expect(section?.bar.kind).toBe("blocks");
		if (section?.bar.kind !== "blocks") return;
		expect(section.bar.blocks.map((b) => b.label)).toEqual(pm25Scale.levels.map((l) => l.label));
		expect(section.bar.blocks[1]).toEqual({
			color: "#ffff00",
			opacity: null,
			label: "Moderate",
			tick: "9"
		});
	});

	it("no display keeps the gradient", () => {
		const section = legendSection(
			{ pluginId: "points", title: "PM2.5", units: "µg/m³", scale: pm25Scale },
			format
		);
		expect(section?.bar.kind).toBe("gradient");
	});
});
