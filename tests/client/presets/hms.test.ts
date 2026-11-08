import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification } from "@maptiler/sdk";
import type { FeatureCollection, Geometry } from "geojson";
import { flushSync, tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import type { MapFeatureProperties } from "../../../src/lib/data/types.js";
import { hmsFirePlugin } from "../../../src/lib/presets/hms-fire.js";
import { hmsSmokePlugin } from "../../../src/lib/presets/hms-smoke.js";
import { createFakeGl } from "../../fixtures/fake-gl.js";
import { fireScale, smokeScale } from "../../fixtures/scales.js";
import { points, TestSource } from "../../fixtures/sources.svelte.js";

type Props = MapFeatureProperties;

const SMOKE: FeatureCollection<Geometry, Props> = {
	type: "FeatureCollection",
	features: [
		{
			type: "Feature",
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[0, 0],
						[2, 0],
						[2, 2],
						[0, 2],
						[0, 0]
					]
				]
			},
			properties: { refKey: "feature:smoke-1", name: "Smoke", value: "medium" }
		}
	]
};

function evaluate(expr: unknown, properties: Record<string, unknown>, type = "string"): unknown {
	const result = createExpression(expr, { type } as never);
	if (result.result !== "success") throw new Error(JSON.stringify(result.value));
	return result.value.evaluate({ zoom: 0 }, { type: 1, properties } as never);
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	expect(errorSpy).not.toHaveBeenCalled();
	errorSpy.mockRestore();
	vi.unstubAllGlobals();
});

describe("hmsSmokePlugin", () => {
	const ref = { dataset: "hms-smoke", entryType: "smoke-density" };

	it("has defaults, is not selectable, and lists its plumes with their level", () => {
		const source = new TestSource<Props>({ features: SMOKE, scale: ref });
		const plugin = hmsSmokePlugin({ source, layerLabel: "Smoke" });
		expect(plugin.id).toBe("hms-smoke");
		expect(plugin.label).toBe("Smoke");
		expect(plugin.dataset).toBe("hms-smoke");
		expect(plugin.selectable).toBe(false);
		source.scale = smokeScale;
		const items = plugin.features!();
		expect(items.length).toBeGreaterThan(0);
		expect(items[0]).toMatchObject({
			refKey: "feature:smoke-1",
			name: "Smoke",
			value: "medium",
			selectable: false
		});
		expect(items[0].level).toMatchObject({ key: "medium" });
		expect(hmsSmokePlugin({ id: "x", source, layerLabel: "S" }).id).toBe("x");
	});

	it("fills by density and uses each level's opacity", async () => {
		const source = new TestSource<Props>({ features: SMOKE, scale: smokeScale });
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(hmsSmokePlugin({ source, layerLabel: "Smoke" }));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		const fill = gl.layers.find((l) => l.id.endsWith(":fill")) as Extract<
			LayerSpecification,
			{ type: "fill" }
		>;
		const opacity = fill.paint!["fill-opacity"];
		expect((opacity as unknown[])[0]).toBe("match");
		const at = (value: string) => evaluate(opacity, { value }, "number");
		expect(at("light")).toBe(0.2);
		expect(at("medium")).toBe(0.3);
		expect(at("heavy")).toBe(0.4);
		expect(evaluate(fill.paint!["fill-color"], { value: "heavy" })).toBe("#333634");
	});
});

describe("hmsSmokePlugin hover", () => {
	it("takes no hover, so plumes show no hover tooltip", () => {
		const source = new TestSource({ features: null, scale: smokeScale });
		expect(hmsSmokePlugin({ source, layerLabel: "Smoke" }).hoverable).toBe(false);
	});
});

describe("hmsSmokePlugin outline", () => {
	it("hmsSmokePlugin uses level outline", async () => {
		const source = new TestSource<Props>({ features: SMOKE, scale: smokeScale });
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(hmsSmokePlugin({ source, layerLabel: "Smoke" }));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		const outline = gl.layers.find((l) => l.id.endsWith(":outline")) as Extract<
			LayerSpecification,
			{ type: "line" }
		>;
		expect(evaluate(outline.paint!["line-color"], { value: "heavy" })).toBe("#333634");
		expect(evaluate(outline.paint!["line-color"], { value: "light" })).toBe("#bfc8c3");
		expect(evaluate(outline.paint!["line-opacity"], { value: "medium" }, "number")).toBe(0.3);
	});
});

describe("hmsFirePlugin", () => {
	const ref = { dataset: "hms-fire", entryType: "fire-frp" };

	it("has defaults, is not selectable, and lists its fires", () => {
		const source = new TestSource<Props>({
			features: points([{ refKey: "feature:f1", name: "Fire", value: 45 }]),
			scale: ref
		});
		const plugin = hmsFirePlugin({ source, layerLabel: "Fire" });
		expect(plugin.id).toBe("hms-fire");
		expect(plugin.label).toBe("Fire");
		expect(plugin.dataset).toBe("hms-fire");
		expect(plugin.selectable).toBe(false);
		expect(plugin.features).toBeTypeOf("function");
		expect(hmsFirePlugin({ id: "x", source, layerLabel: "F" }).id).toBe("x");
	});

	it("reports its legend as blocks", () => {
		const source = new TestSource<Props>({ features: points([]), scale: fireScale });
		const data = hmsFirePlugin({ source, layerLabel: "Fire" }).legend?.();
		expect(data).toMatchObject({ display: "blocks", title: "Fire" });
	});

	it("picks the icon of the level for FRP 9.9 and 10 and sizes it by level", async () => {
		const sources: string[] = [];
		class FakeImage {
			onload: (() => void) | null = null;
			constructor(
				public width: number,
				public height: number
			) {}
			set src(v: string) {
				sources.push(decodeURIComponent(v));
				queueMicrotask(() => this.onload?.());
			}
		}
		vi.stubGlobal("Image", FakeImage);
		const source = new TestSource<Props>({
			features: points([
				{ refKey: "feature:a", name: "A", value: 9.9 },
				{ refKey: "feature:b", name: "B", value: 10 }
			]),
			scale: fireScale
		});
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(hmsFirePlugin({ source, layerLabel: "Fire" }));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		await Promise.resolve();
		await Promise.resolve();
		const icons = gl.layers.find((l) => l.id === `${map.uid}:hms-fire:points`) as Extract<
			LayerSpecification,
			{ type: "symbol" }
		>;
		const imageFor = (value: number) =>
			evaluate(icons.layout!["icon-image"], { value, "mapsdk:category": "fire" });
		expect(imageFor(9.9)).toBe(`${map.uid}:hms-fire:icon:0:fire:sm`);
		expect(imageFor(10)).toBe(`${map.uid}:hms-fire:icon:0:fire:md`);
		expect(imageFor(400)).toBe(`${map.uid}:hms-fire:icon:0:fire:xxl`);
		// One image per level plus the neutral one; color from the scale, size from the index.
		const fireSvgs = sources.filter((s) => s.includes('viewBox="0 -960 960 960"'));
		expect(fireSvgs).toHaveLength(fireScale.levels.length + 1);
		fireScale.levels.forEach((level, i) => {
			const size = [20, 24, 28, 32, 36][i];
			expect(
				fireSvgs.some((s) => s.includes(`fill="${level.color}"`) && s.includes(`width="${size}"`))
			).toBe(true);
		});
	});
});

describe("hmsFirePlugin with hotspots", () => {
	const groupRows = [
		{ refKey: "feature:hms-fire-group-cluster-1", name: "Fire group", value: 45 },
		{ refKey: "feature:hms-fire-group-cluster-2", name: "Fire group", value: 200 }
	];
	const hotspotRows = [
		{ refKey: "feature:f1", name: "Fire", value: 40 },
		{ refKey: "feature:f2", name: "Fire", value: 50 },
		{ refKey: "feature:f3", name: "Fire", value: 200 }
	];

	async function build() {
		const groups = new TestSource<Props>({ features: points(groupRows), scale: fireScale });
		const hotspots = new TestSource<Props>({ features: points(hotspotRows), scale: fireScale });
		const plugin = hmsFirePlugin({ source: groups, hotspots, layerLabel: "Fires" });
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(plugin);
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		const id = (local: string) => `${map.uid}:hms-fire:${local}`;
		return { plugin, map, gl, id };
	}

	it("is one plugin: one id, not selectable, the groups' legend and list", async () => {
		const { plugin, map } = await build();
		expect(map.plugins.map((p) => p.id)).toEqual(["hms-fire"]);
		expect(plugin.selectable).toBe(false);
		expect(plugin.legend?.()).toMatchObject({ display: "blocks", title: "Fires" });
		expect(plugin.features?.().map((f) => f.refKey)).toEqual(groupRows.map((r) => r.refKey));
		const ref = { dataset: "hms-fire", entryType: "fire-frp" };
		const withRefs = hmsFirePlugin({
			source: new TestSource<Props>({ features: points([]), scale: ref }),
			hotspots: new TestSource<Props>({ features: points([]), scale: ref }),
			layerLabel: "Fires"
		});
		expect(withRefs.dataset).toBe("hms-fire");
	});

	it("draws groups below zoom 10 and hotspots from zoom 10, on the layers", async () => {
		const { gl, id } = await build();
		expect(gl.sources.has(id("groups:points"))).toBe(true);
		expect(gl.sources.has(id("hotspots:points"))).toBe(true);
		const groupLayers = gl.layers.filter((l) => l.id.startsWith(id("groups:")));
		const hotspotLayers = gl.layers.filter((l) => l.id.startsWith(id("hotspots:")));
		expect(groupLayers.map((l) => l.id)).toContain(id("groups:points"));
		expect(hotspotLayers.map((l) => l.id)).toContain(id("hotspots:points"));
		expect(groupLayers.length + hotspotLayers.length).toBe(gl.layers.length);
		const shown = (layers: typeof groupLayers) =>
			new Set(layers.map((l) => (l as { layout?: { visibility?: string } }).layout?.visibility));
		// By the camera zoom, so the two meet with no gap on a globe: groups below 10, hotspots
		// from 10.
		for (const layer of [...groupLayers, ...hotspotLayers]) {
			expect(layer).not.toHaveProperty("minzoom");
			expect(layer).not.toHaveProperty("maxzoom");
		}
		expect(shown(groupLayers)).toEqual(new Set(["visible"]));
		expect(shown(hotspotLayers)).toEqual(new Set(["none"]));
		gl.jumpTo({ zoom: 10 });
		gl.emit("zoom", {});
		expect(shown(groupLayers)).toEqual(new Set(["none"]));
		expect(shown(hotspotLayers)).toEqual(new Set(["visible"]));
		gl.jumpTo({ zoom: 9.99 });
		gl.emit("zoom", {});
		expect(shown(groupLayers)).toEqual(new Set(["visible"]));
		expect(shown(hotspotLayers)).toEqual(new Set(["none"]));
		// Each draws from its own source and its own icon images.
		const hotspotPoints = gl.layers.find((l) => l.id === id("hotspots:points")) as Extract<
			LayerSpecification,
			{ type: "symbol" }
		>;
		expect(hotspotPoints.source).toBe(id("hotspots:points"));
		expect(
			evaluate(hotspotPoints.layout!["icon-image"], { value: 45, "mapsdk:category": "fire" })
		).toBe(id("hotspots:icon:0:fire:md"));
	});

	it("hit-tests both the groups and the hotspots as the one plugin", async () => {
		const { map, gl, id } = await build();
		const rendered = (layer: string, props: Props) => ({
			layer: { id: id(layer) },
			source: id(layer),
			properties: { ...props },
			geometry: { type: "Point" as const, coordinates: [0, 0] }
		});
		gl.setRenderedFeatures([
			rendered("hotspots:points", hotspotRows[0]),
			rendered("groups:points", groupRows[0])
		]);
		expect(map.featuresAt({ x: 1, y: 2 }).map((h) => [h.pluginId, h.refKey])).toEqual([
			["hms-fire", "feature:f1"],
			["hms-fire", "feature:hms-fire-group-cluster-1"]
		]);
	});

	it("groups have the box tooltip, which shows the name, and list cut-off values", async () => {
		const { plugin } = await build();
		expect(plugin.tooltipShowsName).toBe(true);
		const items = plugin.features?.() ?? [];
		expect(items.length).toBeGreaterThan(0);
		for (const item of items) {
			expect(item.truncate).toBe(true);
			expect(plugin.tooltip?.(item)).toBeTypeOf("function");
		}
	});

	it("hovering a hotspot gives the same content as a group, without listing it", async () => {
		const { plugin, map } = await build();
		const hit = (refKey: string) => ({ pluginId: "hms-fire", refKey, name: "Fire" }) as never;
		expect(plugin.hoverTooltip?.(hit("feature:f3"))).toBeTypeOf("function");
		// A key no hotspot has gets nothing, and hotspots aren't listed.
		expect(plugin.hoverTooltip?.(hit("feature:other"))).toBeUndefined();
		expect(plugin.features?.().map((f) => f.refKey)).not.toContain("feature:f3");
		map.removePlugin("hms-fire");
		expect(plugin.hoverTooltip?.(hit("feature:f3"))).toBeUndefined();
	});

	it("teardown removes every layer and source once; a restyle adds them again", async () => {
		const { map, gl } = await build();
		const layers = gl.layers.map((l) => l.id);
		const sources = [...gl.sources.keys()];
		map.themeChanged();
		flushSync();
		expect(gl.layers.map((l) => l.id)).toEqual(layers);
		expect([...gl.sources.keys()]).toEqual(sources);
		gl.calls.length = 0;
		map.removePlugin("hms-fire");
		expect(gl.layers).toHaveLength(0);
		expect(gl.sources.size).toBe(0);
		for (const layer of layers) {
			expect(gl.calls.filter((c) => c === `removeLayer:${layer}`)).toHaveLength(1);
		}
		for (const source of sources) {
			expect(gl.calls.filter((c) => c === `removeSource:${source}`)).toHaveLength(1);
		}
	});

	it("without hotspots draws its one source at every zoom", async () => {
		const source = new TestSource<Props>({ features: points(groupRows), scale: fireScale });
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(hmsFirePlugin({ source, layerLabel: "Fires" }));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		const pointsLayer = gl.layers.find((l) => l.id === `${map.uid}:hms-fire:points`);
		expect(pointsLayer).toBeDefined();
		expect(pointsLayer).not.toHaveProperty("minzoom");
		expect(pointsLayer).not.toHaveProperty("maxzoom");
	});
});
