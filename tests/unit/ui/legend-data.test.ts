import { describe, expect, it } from "vitest";
import { createDefaultFormat } from "../../../src/lib/data/format.js";
import {
	legendSection,
	shareSections,
	swatchOverBackground,
	type LegendEntry
} from "../../../src/lib/ui/legend-data.js";
import type { LegendData } from "../../../src/lib/core/plugin.js";
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

describe("shareSections", () => {
	const PM25 = { dataset: "air-quality", entryType: "pm25" };
	const scaleEntry = (data: Partial<LegendData> & { pluginId: string }): LegendEntry => ({
		kind: "scale",
		section: legendSection(
			{ title: data.pluginId, units: "µg/m³", scale: pm25Scale, ...data } as LegendData,
			format
		)!
	});
	const titles = (entries: LegendEntry[]) =>
		entries.map((e) => (e.kind === "scale" ? e.section.title : e.kind));
	const smoke: LegendEntry = {
		kind: "scale",
		section: legendSection(
			{ pluginId: "smoke", title: "Smoke", units: "", scale: smokeScale },
			format
		)!
	};

	it("merges sections with the same ScaleRef at the first one's place", () => {
		const out = shareSections([
			scaleEntry({ pluginId: "regions", title: "Counties", scaleRef: PM25 }),
			smoke,
			scaleEntry({ pluginId: "monitors", title: "PM2.5", scaleRef: PM25, scaleLabel: "PM2.5" })
		]);
		expect(titles(out)).toEqual(["PM2.5", "Smoke"]);
		expect(out[0].kind === "scale" && out[0].section.pluginId).toBe("regions");
		expect(out[0].kind === "scale" && out[0].section.units).toBe("µg/m³");
	});

	it("keeps a lone section's title", () => {
		const out = shareSections([
			scaleEntry({ pluginId: "regions", title: "Counties", scaleRef: PM25, scaleLabel: "PM2.5" })
		]);
		expect(titles(out)).toEqual(["Counties"]);
	});

	it("is titled with the scale's own label until a member's label arrives, so it doesn't flip", () => {
		const out = shareSections([
			scaleEntry({ pluginId: "regions", title: "Counties", scaleRef: PM25 }),
			scaleEntry({ pluginId: "monitors", title: "Monitors", scaleRef: PM25 })
		]);
		expect(titles(out)).toEqual(["PM2.5"]);
	});

	it("falls back to the first title when neither a member nor the scale has a label", () => {
		const unlabeled = { ...pm25Scale, label: "" };
		const out = shareSections([
			scaleEntry({ pluginId: "regions", title: "Counties", scaleRef: PM25, scale: unlabeled }),
			scaleEntry({ pluginId: "monitors", title: "Monitors", scaleRef: PM25, scale: unlabeled })
		]);
		expect(titles(out)).toEqual(["Counties"]);
	});

	it("doesn't merge different entry types, datasets, or a literal scale", () => {
		const out = shareSections([
			scaleEntry({ pluginId: "a", title: "A", scaleRef: PM25 }),
			scaleEntry({ pluginId: "b", title: "B", scaleRef: { ...PM25, entryType: "o3" } }),
			scaleEntry({ pluginId: "c", title: "C", scaleRef: { ...PM25, dataset: "other" } }),
			scaleEntry({ pluginId: "d", title: "D" })
		]);
		expect(titles(out)).toEqual(["A", "B", "C", "D"]);
	});

	it("noFigure is true when any member has it", () => {
		const out = shareSections([
			scaleEntry({ pluginId: "monitors", title: "PM2.5", scaleRef: PM25 }),
			scaleEntry({ pluginId: "regions", title: "Counties", scaleRef: PM25, noFigure: true })
		]);
		expect(out[0].kind === "scale" && out[0].section.noFigure).toBe(true);
		expect(
			shareSections([scaleEntry({ pluginId: "x", title: "X", scaleRef: PM25 })]).map(
				(e) => e.kind === "scale" && e.section.noFigure
			)
		).toEqual([false]);
	});

	it("carries noFigureLabel onto the section", () => {
		const [entry] = shareSections([
			scaleEntry({ pluginId: "regions", noFigure: true, noFigureLabel: "Not enough data" })
		]);
		expect(entry.kind === "scale" && entry.section.noFigureLabel).toBe("Not enough data");
	});

	it("treats a blank noFigureLabel as unset, alone and shared", () => {
		const [alone] = shareSections([
			scaleEntry({ pluginId: "regions", noFigure: true, noFigureLabel: "  " })
		]);
		expect(alone.kind === "scale" && "noFigureLabel" in alone.section).toBe(false);
		const [shared] = shareSections([
			scaleEntry({ pluginId: "a", scaleRef: PM25, noFigure: true, noFigureLabel: " " }),
			scaleEntry({ pluginId: "b", scaleRef: PM25, noFigureLabel: " Not enough data " })
		]);
		expect(shared.kind === "scale" && shared.section.noFigureLabel).toBe("Not enough data");
	});

	it("a shared section takes the first noFigureLabel that is set", () => {
		const [entry] = shareSections([
			scaleEntry({ pluginId: "monitors", title: "PM2.5", scaleRef: PM25 }),
			scaleEntry({
				pluginId: "regions",
				title: "Counties",
				scaleRef: PM25,
				noFigure: true,
				noFigureLabel: "Not enough data"
			})
		]);
		expect(entry.kind === "scale" && entry.section.noFigureLabel).toBe("Not enough data");
	});

	it("a loading member doesn't drop the shared section", () => {
		const loading: LegendEntry = {
			kind: "status",
			pluginId: "fires",
			layer: "Fires",
			status: { state: "loading" }
		};
		const out = shareSections([
			loading,
			scaleEntry({ pluginId: "regions", title: "Counties", scaleRef: PM25 }),
			scaleEntry({ pluginId: "monitors", title: "PM2.5", scaleRef: PM25, scaleLabel: "PM2.5" })
		]);
		expect(titles(out)).toEqual(["status", "PM2.5"]);
	});
});

describe("unit line and note", () => {
	const PM25 = { dataset: "air-quality", entryType: "pm25" };
	const note = (() => {}) as unknown as import("svelte").Snippet;
	const other = (() => {}) as unknown as import("svelte").Snippet;
	const entry = (data: Partial<LegendData> & { pluginId: string }): LegendEntry => ({
		kind: "scale",
		section: legendSection(
			{
				title: data.pluginId,
				units: "lbs",
				scale: pm25Scale,
				scaleRef: PM25,
				...data
			} as LegendData,
			format
		)!
	});

	it("legendSection carries unitsLine and note", () => {
		const section = legendSection(
			{
				pluginId: "t",
				title: "T",
				units: "lbs",
				scale: pm25Scale,
				unitsLine: "lbs per township",
				note
			},
			format
		)!;
		expect(section.unitsLine).toBe("lbs per township");
		expect(section.note).toBe(note);
		const plain = legendSection(
			{ pluginId: "t", title: "T", units: "lbs", scale: pm25Scale },
			format
		)!;
		expect(plain).not.toHaveProperty("unitsLine");
		expect(plain).not.toHaveProperty("note");
	});

	it("a shared section takes the first set unitsLine and note", () => {
		const [shared] = shareSections([
			entry({ pluginId: "a" }),
			entry({ pluginId: "b", unitsLine: "lbs per section", note }),
			entry({ pluginId: "c", unitsLine: "other", note: other })
		]);
		expect(shared.kind === "scale" && shared.section.unitsLine).toBe("lbs per section");
		expect(shared.kind === "scale" && shared.section.note).toBe(note);
	});
});
