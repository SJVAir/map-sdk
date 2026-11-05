import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { GeoJSONSourceSpecification, LayerSpecification } from "@maptiler/sdk";
import { InteractionRouter } from "../../../src/lib/core/interactions.svelte.js";
import type { Providers } from "../../../src/lib/core/plugin.js";
import { PluginHost } from "../../../src/lib/core/plugin-host.svelte.js";
import type { FormatProvider } from "../../../src/lib/data/format.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import type { MetadataProvider } from "../../../src/lib/data/metadata.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";
import type { Scale, ScaleRef } from "../../../src/lib/data/scale-types.js";
import type { MapFeatureProperties } from "../../../src/lib/data/types.js";
import { pointsPlugin, type PointsOptions } from "../../../src/lib/plugins/points.svelte.js";
import {
	colorExpression,
	FALLBACK_THEME_COLORS,
	levelKeyExpression
} from "../../../src/lib/plugins/style.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";
import { burnScale, fireScale, pm25Scale, smokeScale } from "../../fixtures/scales.js";
import { points, TestSource } from "../../fixtures/sources.svelte.js";

type Props = MapFeatureProperties & { type?: string };

const PM25_REF: ScaleRef = { dataset: "air-quality", entryType: "pm25" };

function metadata(result: Scale | "unavailable" | Promise<Scale | "unavailable">) {
	return {
		scale: vi.fn(() => Promise.resolve(result)),
		entryType: vi.fn(() => Promise.resolve("unavailable"))
	} as unknown as MetadataProvider & { scale: ReturnType<typeof vi.fn> };
}

function setup(
	options: Partial<PointsOptions<Props>> & { source: TestSource<Props> },
	meta: MetadataProvider = metadata(pm25Scale)
) {
	const selected = new SvelteMap<string, ReadonlySet<string>>();
	const router = new InteractionRouter();
	const providers: Providers = {
		metadata: meta,
		messages: defaultMessages,
		format: {} as FormatProvider
	};
	const host = new PluginHost({
		mapUid: "m1",
		providers,
		router,
		selectedKeys: (pluginId) => selected.get(pluginId) ?? new Set()
	});
	const plugin = pointsPlugin<Props>({
		id: "pts",
		layerLabel: "Monitors",
		circle: { radius: 6 },
		...options
	});
	host.add(plugin);
	const gl = createFakeGl({ styleLoaded: true });
	host.attach(gl);
	flushSync();
	return { host, plugin, gl, selected, router };
}

/** Lets a resolved scale promise land, then runs effects. */
async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	flushSync();
}

const layerIds = (gl: FakeGl) => gl.layers.map((l) => l.id);
const layer = (gl: FakeGl, id: string) => gl.layers.find((l) => l.id === id)!;
const sourceData = (gl: FakeGl, id: string) =>
	(gl.sources.get(id) as GeoJSONSourceSpecification).data as GeoJSON.FeatureCollection;

const ROWS: Props[] = [
	{ refKey: "monitor:a", name: "Alpha", value: 4 },
	{ refKey: "monitor:b", name: "Bravo", value: 40 }
];

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	expect(errorSpy).not.toHaveBeenCalled();
	errorSpy.mockRestore();
});

describe("pointsPlugin", () => {
	it("names its layer and the dataset of a ScaleRef source, none for a Scale", () => {
		const ref = new TestSource<Props>({ scale: PM25_REF });
		const refPlugin = pointsPlugin({
			id: "p",
			source: ref,
			layerLabel: "monitors",
			circle: { radius: 5 }
		});
		expect(refPlugin.label).toBe("monitors");
		expect(refPlugin.dataset).toBe("air-quality");
		const literal = new TestSource<Props>({ scale: pm25Scale });
		expect(
			pointsPlugin({ id: "p", source: literal, layerLabel: "m", circle: { radius: 5 } }).dataset
		).toBeUndefined();
	});

	it("adds no layers and reports the status while the scale is unavailable", async () => {
		const source = new TestSource<Props>({ features: points(ROWS), scale: PM25_REF });
		const meta = metadata("unavailable");
		const { gl, plugin } = setup({ source }, meta);
		expect(plugin.legend!()).toEqual({ pluginId: "pts", status: { state: "loading" } });
		await settle();
		expect(meta.scale).toHaveBeenCalledWith(PM25_REF, expect.any(AbortSignal));
		expect(gl.layers).toEqual([]);
		expect(plugin.legend!()).toEqual({
			pluginId: "pts",
			status: { state: "unavailable", reason: expect.any(String) }
		});
	});

	it("draws circles colored by the scale once it resolves", async () => {
		const source = new TestSource<Props>({ features: points(ROWS), scale: PM25_REF });
		const { gl, plugin } = setup({ source });
		expect(gl.layers).toEqual([]);
		await settle();
		expect(layerIds(gl)).toEqual(["m1:pts:points", "m1:pts:selected"]);
		const circles = layer(gl, "m1:pts:points") as Extract<LayerSpecification, { type: "circle" }>;
		expect(circles.paint!["circle-color"]).toEqual(
			colorExpression(pm25Scale, "value", FALLBACK_THEME_COLORS.neutral)
		);
		expect(circles.paint!["circle-radius"]).toBe(6);
		expect(gl.sources.get("m1:pts:points")).toMatchObject({ type: "geojson", promoteId: "refKey" });
		expect(plugin.legend!()).toEqual({
			pluginId: "pts",
			title: "Monitors",
			units: "µg/m³",
			scale: pm25Scale
		});
	});

	it("uses a Scale object as-is without asking the metadata provider", () => {
		const source = new TestSource<Props>({ features: points(ROWS), scale: pm25Scale });
		const meta = metadata("unavailable");
		const { gl } = setup({ source }, meta);
		expect(meta.scale).not.toHaveBeenCalled();
		expect(layerIds(gl)).toEqual(["m1:pts:points", "m1:pts:selected"]);
	});

	it("re-renders new features with setData on the same source, without re-adding layers", () => {
		const source = new TestSource<Props>({ features: points(ROWS), scale: pm25Scale });
		const { gl } = setup({ source });
		const before = gl.calls.length;
		source.features = points([{ refKey: "monitor:c", name: "Charlie", value: 100 }]);
		flushSync();
		const after = gl.calls.slice(before);
		expect(after.filter((c) => c.startsWith("setData"))).toEqual(["setData:m1:pts:points"]);
		expect(after.filter((c) => /^(add|remove)(Layer|Source)/.test(c))).toEqual([]);
		const data = sourceData(gl, "m1:pts:points");
		expect(data.features.map((f) => f.properties!.refKey)).toEqual(["monitor:c"]);
	});

	it("sets feature-state selected for selected keys and clears it when deselected", () => {
		const source = new TestSource<Props>({ features: points(ROWS), scale: pm25Scale });
		const { gl, selected } = setup({ source, selectable: true });
		selected.set("pts", new SvelteSet(["monitor:a"]));
		flushSync();
		expect(gl.featureStates.get("m1:pts:points/monitor:a")).toEqual({ selected: true });
		selected.set("pts", new SvelteSet(["monitor:b"]));
		flushSync();
		expect(gl.featureStates.get("m1:pts:points/monitor:a")?.selected).toBeUndefined();
		expect(gl.featureStates.get("m1:pts:points/monitor:b")).toEqual({ selected: true });
		const overlay = layer(gl, "m1:pts:selected") as Extract<LayerSpecification, { type: "symbol" }>;
		expect(overlay.type).toBe("symbol");
		expect(overlay.layout!["icon-image"]).toBe("m1:pts:selected");
		expect(overlay.paint!["icon-opacity"]).toEqual([
			"case",
			["boolean", ["feature-state", "selected"], false],
			1,
			0
		]);
	});

	it("shows data and selection replaced while detached once attached again", () => {
		const source = new TestSource<Props>({ features: points(ROWS), scale: pm25Scale });
		const { host, selected } = setup({ source, selectable: true });
		host.detach();
		source.features = points([{ refKey: "monitor:z", name: "Zulu", value: 12 }]);
		selected.set("pts", new SvelteSet(["monitor:z"]));
		flushSync();
		const gl2 = createFakeGl({ styleLoaded: true });
		host.attach(gl2);
		flushSync();
		const data = sourceData(gl2, "m1:pts:points");
		expect(data.features.map((f) => f.properties!.refKey)).toEqual(["monitor:z"]);
		expect(gl2.featureStates.get("m1:pts:points/monitor:z")).toEqual({ selected: true });
		expect(layerIds(gl2)).toEqual(["m1:pts:points", "m1:pts:selected"]);
	});

	it("lists features with their level, and NO_LEVEL for a null value", () => {
		const source = new TestSource<Props>({
			features: points([
				{ refKey: "monitor:a", name: "Alpha", value: 4, lngLat: [-119.5, 36.2] },
				{ refKey: "monitor:n", name: "Nil", value: null }
			]),
			scale: pm25Scale
		});
		const { plugin } = setup({ source, selectable: true });
		const items = plugin.features!();
		expect(items[0]).toEqual({
			refKey: "monitor:a",
			ref: { kind: "monitor", id: "a" },
			name: "Alpha",
			value: 4,
			level: pm25Scale.levels[0],
			units: "µg/m³",
			precision: 0,
			lngLat: [-119.5, 36.2],
			selectable: true
		});
		expect(items[1].level).toBe(NO_LEVEL);
	});

	it("gives items the metadata's display precision once known, else 0 for a range scale", async () => {
		const meta = {
			scale: vi.fn(() => Promise.resolve(pm25Scale)),
			entryType: vi.fn(() => Promise.resolve({ label: "PM2.5", units: "µg/m³", precision: 1 }))
		} as unknown as MetadataProvider;
		const source = new TestSource<Props>({
			features: points([{ refKey: "monitor:a", name: "Alpha", value: 7.971 }]),
			scale: PM25_REF
		});
		const { plugin } = setup({ source }, meta);
		await settle();
		expect(plugin.features!()[0].precision).toBe(1);
		expect(meta.entryType).toHaveBeenCalledWith(PM25_REF, expect.any(AbortSignal));

		// A literal scale has no display hint: 0 for a range scale, 1 otherwise.
		source.scale = fireScale;
		expect(plugin.features!()[0].precision).toBe(0);
		source.scale = smokeScale;
		expect(plugin.features!()[0].precision).toBe(1);
	});

	it("creates one clustered source per group", () => {
		const source = new TestSource<Props>({
			features: points([
				{ refKey: "monitor:a", name: "A", value: 1, type: "purple" },
				{ refKey: "monitor:b", name: "B", value: 2, type: "airnow" },
				{ refKey: "monitor:c", name: "C", value: 3, type: "purple" }
			]),
			scale: pm25Scale
		});
		const { gl } = setup({
			source,
			cluster: { radius: 40, maxZoom: 9, groupBy: (p) => p.type ?? "" }
		});
		const purple = gl.sources.get("m1:pts:points:purple") as GeoJSONSourceSpecification;
		const airnow = gl.sources.get("m1:pts:points:airnow") as GeoJSONSourceSpecification;
		expect(purple).toMatchObject({ cluster: true, clusterRadius: 40, clusterMaxZoom: 9 });
		expect(airnow).toMatchObject({ cluster: true, clusterRadius: 40, clusterMaxZoom: 9 });
		expect(sourceData(gl, "m1:pts:points:purple").features).toHaveLength(2);
		expect(sourceData(gl, "m1:pts:points:airnow").features).toHaveLength(1);
		const unclustered = layer(gl, "m1:pts:points:purple") as Extract<
			LayerSpecification,
			{ type: "circle" }
		>;
		expect(unclustered.filter).toEqual(["!", ["has", "point_count"]]);
	});

	it("hides what is under a default bubble, shows no tooltip for it, and zooms on click", async () => {
		const source = new TestSource<Props>({
			features: points([
				{ refKey: "monitor:a", name: "A", value: 1 },
				{ refKey: "monitor:b", name: "B", value: 2 }
			]),
			scale: pm25Scale
		});
		const { gl, router, plugin } = setup({ source, cluster: { radius: 40, maxZoom: 9 } });
		const expansionZoom = vi.fn(async () => 12);
		const getSource = gl.getSource.bind(gl);
		gl.getSource = (id: string) => {
			const found = getSource(id) as object | undefined;
			return found && { ...found, getClusterExpansionZoom: expansionZoom };
		};
		router.attach(gl);
		gl.setRenderedFeatures([
			{
				layer: { id: "m1:pts:clusters" },
				source: "m1:pts:points",
				properties: { cluster: true, cluster_id: 9, point_count: 2 },
				geometry: { type: "Point", coordinates: [-119, 36] }
			},
			{
				layer: { id: "m1:pts:points" },
				source: "m1:pts:points",
				properties: { refKey: "monitor:a", name: "A" },
				geometry: { type: "Point", coordinates: [-119, 36] }
			}
		]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119, lat: 36 } });
		expect(router.hovered).toBeNull();
		expect(plugin.hoverTooltip).toBeUndefined();
		const picks = vi.fn();
		router.onPick(picks);
		gl.emit("click", { point: { x: 1, y: 2 }, lngLat: { lng: -119, lat: 36 } });
		await settle();
		expect(picks).not.toHaveBeenCalled();
		expect(expansionZoom).toHaveBeenCalledWith(9);
		expect(gl.getZoom()).toBe(12);
	});

	it("draws muted images in theme mutedForeground unless icon.mutedColor says otherwise", () => {
		vi.stubGlobal(
			"Image",
			class {
				onload: (() => void) | null = null;
				set src(_v: string) {}
			}
		);
		try {
			const run = (mutedColor?: string) => {
				const source = new TestSource<Props>({
					features: points([{ refKey: "monitor:a", name: "A", value: 1, type: "purple" }]),
					scale: pm25Scale
				});
				const draw = vi.fn((category: string, color: string) => `<svg>${category}${color}</svg>`);
				setup({
					source,
					circle: undefined,
					icon: { category: (p) => p.type ?? "", draw, size: 24, muted: () => true, mutedColor }
				});
				return draw;
			};
			expect(run()).toHaveBeenCalledWith(
				"purple",
				FALLBACK_THEME_COLORS.mutedForeground,
				FALLBACK_THEME_COLORS
			);
			expect(run("#123456")).toHaveBeenCalledWith("purple", "#123456", FALLBACK_THEME_COLORS);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("picks icons by category and level key and registers their images", async () => {
		const images: string[] = [];
		class FakeImage {
			onload: (() => void) | null = null;
			constructor(
				public width: number,
				public height: number
			) {}
			set src(v: string) {
				images.push(v);
				queueMicrotask(() => this.onload?.());
			}
		}
		vi.stubGlobal("Image", FakeImage);
		try {
			const source = new TestSource<Props>({
				features: points([{ refKey: "monitor:a", name: "A", value: 1, type: "purple" }]),
				scale: pm25Scale
			});
			const draw = vi.fn((category: string, color: string) => `<svg>${category}${color}</svg>`);
			const { gl } = setup({
				source,
				circle: undefined,
				icon: { category: (p) => p.type ?? "", draw, size: 24 }
			});
			const icons = layer(gl, "m1:pts:points") as Extract<LayerSpecification, { type: "symbol" }>;
			expect(icons.layout!["icon-image"]).toEqual([
				"concat",
				"m1:pts:icon:0:",
				["get", "mapsdk:category"],
				":",
				levelKeyExpression(pm25Scale, "value")
			]);
			// One image per level of the category, plus the neutral one.
			expect(draw).toHaveBeenCalledWith("purple", "#00e400", FALLBACK_THEME_COLORS, 0);
			expect(draw).toHaveBeenCalledWith(
				"purple",
				FALLBACK_THEME_COLORS.neutral,
				FALLBACK_THEME_COLORS,
				-1
			);
			expect(draw).toHaveBeenCalledTimes(pm25Scale.levels.length + 1);
			await settle();
			expect(gl.images.has("m1:pts:icon:0:purple:good")).toBe(true);
			expect(gl.images.has("m1:pts:icon:0:purple:")).toBe(true);
			expect(gl.images.has("m1:pts:selected")).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("makes hits from the refKey and name", () => {
		const source = new TestSource<Props>({ features: points(ROWS), scale: pm25Scale });
		const { gl, router } = setup({ source });
		router.attach(gl);
		gl.setRenderedFeatures([
			{
				layer: { id: "m1:pts:points" },
				source: "m1:pts:points",
				properties: { refKey: "monitor:a", name: "Alpha", value: 4 },
				geometry: { type: "Point", coordinates: [0, 0] }
			}
		]);
		expect(router.hitsAt([0, 0])).toEqual([
			{ pluginId: "pts", ref: { kind: "monitor", id: "a" }, refKey: "monitor:a", name: "Alpha" }
		]);
	});

	it("ignores a scale that resolves after teardown", async () => {
		let resolve!: (s: Scale) => void;
		const meta = {
			scale: vi.fn(() => new Promise<Scale>((r) => (resolve = r))),
			entryType: () => Promise.resolve("unavailable")
		} as unknown as MetadataProvider;
		const source = new TestSource<Props>({ features: points(ROWS), scale: PM25_REF });
		const { host, gl, plugin } = setup({ source }, meta);
		host.detach();
		resolve(pm25Scale);
		await settle();
		expect(gl.layers).toEqual([]);
		expect(plugin.legend!()).toEqual({ pluginId: "pts", status: { state: "loading" } });
	});

	it("re-resolves and redraws when the source's scale changes", async () => {
		const meta = {
			scale: vi.fn((ref: ScaleRef) =>
				Promise.resolve(ref.entryType === "pm25" ? pm25Scale : fireScale)
			),
			entryType: () => Promise.resolve("unavailable")
		} as unknown as MetadataProvider;
		const source = new TestSource<Props>({ features: points(ROWS), scale: PM25_REF });
		const { gl, plugin } = setup({ source }, meta);
		await settle();
		source.scale = { dataset: "hms-fire", entryType: "fire-frp" };
		flushSync();
		await settle();
		expect(layerIds(gl)).toEqual(["m1:pts:points", "m1:pts:selected"]);
		const circles = layer(gl, "m1:pts:points") as Extract<LayerSpecification, { type: "circle" }>;
		expect(circles.paint!["circle-color"]).toEqual(
			colorExpression(fireScale, "value", FALLBACK_THEME_COLORS.neutral)
		);
		expect(plugin.legend!()).toMatchObject({ units: "MW", scale: fireScale });
	});

	it("draws a level with an empty color in the neutral color", () => {
		vi.stubGlobal(
			"Image",
			class {
				set src(_: string) {}
			}
		);
		try {
			const source = new TestSource<Props>({
				features: points([{ refKey: "feature:x", name: "X", value: "discouraged" }]),
				scale: burnScale
			});
			const draw = vi.fn(() => "<svg/>");
			setup({ source, circle: undefined, icon: { category: () => "burn", draw, size: 16 } });
			expect(draw.mock.calls).toEqual([
				["burn", FALLBACK_THEME_COLORS.neutral, FALLBACK_THEME_COLORS, 0],
				["burn", FALLBACK_THEME_COLORS.neutral, FALLBACK_THEME_COLORS, -1]
			]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("keeps layers and images when the source hands over an equal fresh scale", () => {
		vi.stubGlobal(
			"Image",
			class {
				set src(_: string) {}
			}
		);
		try {
			const source = new TestSource<Props>({ features: points(ROWS), scale: pm25Scale });
			const draw = vi.fn(() => "<svg/>");
			const { gl } = setup({
				source,
				circle: undefined,
				icon: { category: () => "c", draw, size: 16 }
			});
			const drawn = draw.mock.calls.length;
			const before = gl.calls.length;
			source.scale = structuredClone(pm25Scale);
			flushSync();
			const after = gl.calls.slice(before);
			expect(after.filter((c) => /^(add|remove)Layer/.test(c))).toEqual([]);
			expect(draw.mock.calls.length).toBe(drawn);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("shows a selected key that appears later in a group as selected", () => {
		const source = new TestSource<Props>({
			features: points([{ refKey: "monitor:a", name: "A", value: 1, type: "purple" }]),
			scale: pm25Scale
		});
		const { gl, selected } = setup({
			source,
			selectable: true,
			cluster: { radius: 40, maxZoom: 9, groupBy: (p) => p.type ?? "" }
		});
		selected.set("pts", new SvelteSet(["monitor:late"]));
		flushSync();
		expect(gl.featureStates.get("m1:pts:points:purple/monitor:late")).toBeUndefined();
		source.features = points([
			{ refKey: "monitor:a", name: "A", value: 1, type: "purple" },
			{ refKey: "monitor:late", name: "Late", value: 2, type: "airnow" }
		]);
		flushSync();
		expect(gl.featureStates.get("m1:pts:points:airnow/monitor:late")).toEqual({ selected: true });
	});
});
