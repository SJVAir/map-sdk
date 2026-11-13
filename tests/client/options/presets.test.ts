import { describe, expect, it } from "vitest";
import type { BasemapConfig } from "../../../src/lib/core/basemap.svelte.js";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import {
	basemapOptions,
	hmsOptions,
	schoolsOptions,
	settingsGroup
} from "../../../src/lib/options/presets.js";
import type { OptionRow } from "../../../src/lib/options/types.js";

const url = (id: string) => `https://tiles.test/maps/${id}/style.json`;
const style = (id: string, basemap: string, name: string, isDefault = false) => ({
	id,
	style: url(id),
	basemap,
	name,
	isDefault
});

const basemaps: BasemapConfig = {
	styles: [
		style("outdoor-v4", "Outdoor", "Default", true),
		style("outdoor-v4-dark", "Outdoor", "Dark"),
		style("satellite-v4", "Satellite", "Default", true),
		style("streets-v4", "Streets", "Default", true),
		style("streets-v4-dark", "Streets", "Dark"),
		style("streets-v4-pastel", "Streets", "Pastel")
	],
	defaultId: "streets-v4"
};

const mapWith = (config: BasemapConfig = basemaps) =>
	createMap({ config: { maptilerKey: "k", basemaps: config } });

const select = (rows: OptionRow[]) =>
	rows.find((r): r is Extract<OptionRow, { kind: "select" }> => r.kind === "select");
const radio = (rows: OptionRow[]) =>
	rows.find((r): r is Extract<OptionRow, { kind: "radio" }> => r.kind === "radio");

describe("basemapOptions", () => {
	it("a Basemap select with one choice per basemap: its default variant, matching its others", () => {
		const { rows, key, defaults } = basemapOptions(mapWith());
		expect(key).toBe("basemap");
		expect(defaults).toEqual({ basemap: "streets-v4" });
		const s = select(rows)!;
		expect(s.label).toBe("Basemap");
		expect(s.id).toBe("basemap");
		expect(s.choices).toEqual([
			{ value: "outdoor-v4", label: "Outdoor", matches: ["outdoor-v4-dark"] },
			{ value: "satellite-v4", label: "Satellite", matches: [] },
			{ value: "streets-v4", label: "Streets", matches: ["streets-v4-dark", "streets-v4-pastel"] }
		]);
	});

	it("Theme radios list the current basemap's variants", () => {
		const map = mapWith();
		map.basemap.select("outdoor-v4-dark");
		const r = radio(basemapOptions(map).rows)!;
		expect(r.label).toBe("Theme");
		expect(r.id).toBe("basemap");
		expect(r.choices.map((c) => [c.value, c.label])).toEqual([
			["outdoor-v4", "Default"],
			["outdoor-v4-dark", "Dark"]
		]);
	});

	it("leaves out the Theme radios for a basemap with one variant", () => {
		const map = mapWith();
		map.basemap.select("satellite-v4");
		expect(radio(basemapOptions(map).rows)).toBeUndefined();
	});

	it("leaves out the select when there's one basemap (Streets only)", () => {
		const streets: BasemapConfig = {
			styles: basemaps.styles.filter((s) => s.basemap === "Streets"),
			defaultId: "streets-v4"
		};
		const { rows } = basemapOptions(mapWith(streets));
		expect(select(rows)).toBeUndefined();
		expect(radio(rows)!.choices).toHaveLength(3);
	});

	it("an unnamed style is its own basemap, labelled by its id", () => {
		const { rows } = basemapOptions(
			mapWith({
				styles: [
					{ id: "a", style: "x" },
					{ id: "b", style: "y" }
				],
				defaultId: "a"
			})
		);
		expect(select(rows)!.choices.map((c) => c.label)).toEqual(["a", "b"]);
	});

	it("takes a key and icons", () => {
		const icon = { svg: "<svg></svg>" };
		const { rows, key } = basemapOptions(mapWith(), { key: "bm", icons: { basemap: icon } });
		expect(key).toBe("bm");
		expect(select(rows)!.id).toBe("bm");
		expect(select(rows)!.icon).toBe(icon);
	});
});

describe("settingsGroup", () => {
	it("is monitor-map's Settings: icon-only, end-aligned, clusters, basemap rows, reset", () => {
		const { groups, defaults } = settingsGroup(mapWith());
		expect(groups).toHaveLength(1);
		const [g] = groups;
		expect(g).toMatchObject({ id: "settings", label: "Settings", iconOnly: true, align: "end" });
		expect(g.rows.map((r) => r.kind)).toEqual([
			"checkbox",
			"separator",
			"select",
			"radio",
			"separator",
			"reset"
		]);
		expect(g.rows[0]).toMatchObject({ id: "clustered", label: "Marker Clusters" });
		expect(g.rows.at(-1)).toMatchObject({ label: "Reset Map Options" });
		expect(defaults).toEqual({ clustered: true, basemap: "streets-v4" });
	});

	it("leaves out what's turned off, and never two separators in a row", () => {
		const { groups, defaults } = settingsGroup(mapWith(), { clusters: false, reset: false });
		expect(groups[0].rows.map((r) => r.kind)).toEqual(["select", "radio"]);
		expect(defaults).toEqual({ basemap: "streets-v4" });
	});
});

describe("hmsOptions and schoolsOptions", () => {
	it("give one checkbox row each, on by default", () => {
		const map = mapWith();
		expect(hmsOptions(map)).toEqual({
			row: { kind: "checkbox", id: "fireAndSmoke", label: "Fire & Smoke" },
			defaults: { fireAndSmoke: true }
		});
		expect(schoolsOptions(map, { key: "kids" })).toEqual({
			row: { kind: "checkbox", id: "kids", label: "Schools & Child Care" },
			defaults: { kids: true }
		});
	});
});
