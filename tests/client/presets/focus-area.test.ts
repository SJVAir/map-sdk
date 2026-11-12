import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, tick } from "svelte";
import type { GeoJSONSourceSpecification, LayerSpecification } from "@maptiler/sdk";
import type { FeatureCollection, LineString, MultiPolygon, Point, Polygon } from "geojson";
import { InteractionRouter } from "../../../src/lib/core/interactions.svelte.js";
import type { Providers } from "../../../src/lib/core/plugin.js";
import { PluginHost } from "../../../src/lib/core/plugin-host.svelte.js";
import type { FormatProvider } from "../../../src/lib/data/format.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import type { MetadataProvider } from "../../../src/lib/data/metadata.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";
import { FALLBACK_THEME_COLORS } from "../../../src/lib/plugins/style.js";
import {
	focusAreaPlugin,
	type FocusAreaPluginOptions,
	type FocusGeometry
} from "../../../src/lib/presets/focus-area.svelte.js";
import { worldMask } from "../../../src/lib/presets/focus-geometry.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";

const AREA: Polygon = {
	type: "Polygon",
	coordinates: [
		[
			[-120, 36],
			[-119, 36],
			[-119, 37],
			[-120, 37],
			[-120, 36]
		]
	]
};
const LINE: LineString = {
	type: "LineString",
	coordinates: [
		[0, 0],
		[1, 1]
	]
};
const SPOT: Point = { type: "Point", coordinates: [-119.5, 36.5] };

const LAYER_IDS = ["wash", "casing", "line", "ring-casing", "ring", "label"].map(
	(l) => `m1:focus:${l}`
);

function makeHost() {
	const router = new InteractionRouter();
	const providers: Providers = {
		metadata: {} as MetadataProvider,
		messages: defaultMessages,
		format: {} as FormatProvider
	};
	const host = new PluginHost({
		mapUid: "m1",
		providers,
		router,
		selectedKeys: () => new Set()
	});
	return { host, router };
}

async function setup(options: Partial<FocusAreaPluginOptions> = {}) {
	const { host, router } = makeHost();
	const plugin = focusAreaPlugin({ id: "focus", layerLabel: "Places", ...options });
	host.add(plugin);
	const gl = createFakeGl({ styleLoaded: true });
	host.attach(gl);
	await tick();
	return { host, router, plugin, gl };
}

const data = (gl: FakeGl, local: string) =>
	(gl.sources.get(`m1:focus:${local}`) as GeoJSONSourceSpecification).data as FeatureCollection;
const layer = (gl: FakeGl, local: string) =>
	gl.layers.find((l) => l.id === `m1:focus:${local}`) as LayerSpecification & {
		paint: Record<string, unknown>;
		layout?: Record<string, unknown>;
	};

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	expect(errorSpy).not.toHaveBeenCalled();
	errorSpy.mockRestore();
});

describe("focusAreaPlugin", () => {
	it("draws a polygon as wash, casing and line", async () => {
		const { gl } = await setup({ geometry: AREA });
		expect(gl.layers.map((l) => l.id)).toEqual(LAYER_IDS);
		const c = FALLBACK_THEME_COLORS;
		expect(layer(gl, "wash").paint).toEqual({
			"fill-color": c.focusAreaWash,
			"fill-opacity": 0.55
		});
		expect(layer(gl, "casing").paint).toEqual({
			"line-color": c.focusAreaCasing,
			"line-width": 5.5,
			"line-opacity": 0.9
		});
		expect(layer(gl, "line").paint).toEqual({
			"line-color": c.focusArea,
			"line-width": 2.5,
			"line-opacity": 0.9
		});
		expect(layer(gl, "line").layout).toEqual({ "line-join": "round", "line-cap": "round" });
		expect(data(gl, "mask").features.map((f) => f.geometry)).toEqual([worldMask(AREA)]);
		expect(data(gl, "area").features.map((f) => f.geometry)).toEqual([AREA]);
		expect(data(gl, "point").features).toEqual([]);
	});

	it("draws a point as ring casing, ring and label", async () => {
		const { gl } = await setup({ geometry: SPOT, label: "Your location" });
		const c = FALLBACK_THEME_COLORS;
		expect(layer(gl, "ring-casing").paint).toEqual({
			"circle-radius": 11.5,
			"circle-opacity": 0,
			"circle-stroke-width": 6,
			"circle-stroke-color": c.focusAreaCasing,
			"circle-stroke-opacity": 0.9
		});
		expect(layer(gl, "ring").paint).toEqual({
			"circle-radius": 13,
			"circle-opacity": 0,
			"circle-stroke-width": 3,
			"circle-stroke-color": c.focusArea,
			"circle-stroke-opacity": 0.9
		});
		expect(layer(gl, "label").layout).toMatchObject({
			"text-field": ["get", "name"],
			"text-anchor": "left",
			"text-offset": [1.5, 0],
			"text-size": 12,
			"text-allow-overlap": true,
			"text-ignore-placement": true
		});
		expect(layer(gl, "label").paint).toEqual({
			"text-color": c.focusArea,
			"text-halo-color": c.focusAreaCasing,
			"text-halo-width": 2
		});
		expect(data(gl, "point").features).toEqual([
			{
				type: "Feature",
				geometry: SPOT,
				properties: { refKey: "feature:focus", name: "Your location" }
			}
		]);
		expect(data(gl, "area").features).toEqual([]);
		expect(data(gl, "mask").features).toEqual([]);
	});

	it("names an unlabelled point by its layer", async () => {
		const { gl } = await setup({ geometry: SPOT });
		expect(data(gl, "point").features[0].properties).toEqual({
			refKey: "feature:focus",
			name: "Places"
		});
	});

	it("set() replaces the data without re-adding layers", async () => {
		const { plugin, gl } = await setup({ geometry: AREA });
		const before = [...gl.layers];
		plugin.set({ geometry: SPOT, label: "Home" });
		flushSync();
		expect(data(gl, "point").features[0].properties!.name).toBe("Home");
		expect(data(gl, "area").features).toEqual([]);
		expect(data(gl, "mask").features).toEqual([]);
		const multi: MultiPolygon = { type: "MultiPolygon", coordinates: [AREA.coordinates] };
		plugin.set({ geometry: multi });
		flushSync();
		expect(data(gl, "area").features.map((f) => f.geometry)).toEqual([multi]);
		expect(data(gl, "point").features).toEqual([]);
		plugin.set({ geometry: null });
		flushSync();
		for (const local of ["area", "mask", "point"]) expect(data(gl, local).features).toEqual([]);
		expect(gl.layers).toEqual(before);
		expect(plugin.focus.geometry).toBeNull();
	});

	it("set() throws for a LineString and keeps the last geometry", async () => {
		const { plugin } = await setup({ geometry: AREA });
		expect(() => plugin.set({ geometry: LINE as unknown as FocusGeometry })).toThrow(
			"not LineString"
		);
		expect(plugin.focus.geometry).toBe(AREA);
	});

	it("the options throw for a LineString", () => {
		expect(() =>
			focusAreaPlugin({
				layerLabel: "Places",
				geometry: LINE as unknown as FocusGeometry
			})
		).toThrow("not LineString");
	});

	it("defaults its id to focus-area", () => {
		expect(focusAreaPlugin({ layerLabel: "Places" }).id).toBe("focus-area");
	});

	it("set() before attach draws on attach", async () => {
		const { host } = makeHost();
		const plugin = focusAreaPlugin({ id: "focus", layerLabel: "Places" });
		plugin.set({ geometry: SPOT, label: "Here" });
		host.add(plugin);
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
		expect(data(gl, "point").features[0].properties!.name).toBe("Here");
	});

	it("keeps the focus across detach and attach", async () => {
		const { host, plugin } = await setup({ geometry: AREA });
		host.detach();
		plugin.set({ geometry: SPOT, label: "Later" });
		flushSync();
		const gl2 = createFakeGl({ styleLoaded: true });
		host.attach(gl2);
		await tick();
		expect(data(gl2, "point").features[0].properties!.name).toBe("Later");
		expect(data(gl2, "area").features).toEqual([]);
	});

	it("draws again after a restyle", async () => {
		const { host, gl } = await setup({ geometry: AREA });
		host.restyle(true);
		await tick();
		expect(gl.layers.map((l) => l.id)).toEqual(LAYER_IDS);
		expect(data(gl, "area").features.map((f) => f.geometry)).toEqual([AREA]);
	});

	it("registers only the ring layers as interactive", async () => {
		const { gl, router } = await setup({ geometry: SPOT, label: "Here" });
		router.attach(gl);
		const hit = (local: string) => {
			gl.setRenderedFeatures([
				{
					layer: { id: `m1:focus:${local}` },
					source: "m1:focus:x",
					properties: { refKey: "feature:focus", name: "Here" },
					geometry: SPOT
				}
			]);
			return router.hitsAt([-119.5, 36.5]);
		};
		const expected = [
			{
				pluginId: "focus",
				ref: { kind: "feature", id: "focus" },
				refKey: "feature:focus",
				name: "Here"
			}
		];
		expect(hit("ring")).toEqual(expected);
		expect(hit("ring-casing")).toEqual(expected);
		for (const local of ["wash", "casing", "line", "label"]) expect(hit(local)).toEqual([]);
	});

	it("is never selectable", async () => {
		const { plugin } = await setup({ geometry: SPOT });
		expect(plugin.selectable).toBe(false);
	});

	it("lists a point once, by its label, with no reading", async () => {
		const { plugin } = await setup({ geometry: SPOT, label: "Your location" });
		expect(plugin.features!()).toEqual([
			{
				refKey: "feature:focus",
				ref: { kind: "feature", id: "focus" },
				name: "Your location",
				value: null,
				level: NO_LEVEL,
				units: "",
				lngLat: [-119.5, 36.5],
				selectable: false,
				noReading: true
			}
		]);
	});

	it("lists an unlabelled point by its layer name", async () => {
		const { plugin } = await setup({ geometry: SPOT });
		expect(plugin.features!()[0].name).toBe("Places");
	});

	it("lists nothing for an area or no focus", async () => {
		const { plugin } = await setup({ geometry: AREA });
		expect(plugin.features!()).toEqual([]);
		plugin.set({ geometry: null });
		expect(plugin.features!()).toEqual([]);
	});

	it("names a point with a blank label by its layer", async () => {
		const { plugin, gl } = await setup({ geometry: SPOT, label: "  " });
		expect(plugin.features!()[0].name).toBe("Places");
		expect(data(gl, "point").features[0].properties!.name).toBe("Places");
	});

	it("has no summary line while nothing of it is in view", async () => {
		const { plugin } = await setup({ geometry: AREA });
		expect(plugin.summarizeEmpty).toBe(false);
	});
});
