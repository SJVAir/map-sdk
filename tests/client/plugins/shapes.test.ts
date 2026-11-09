import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, tick } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { GeoJSONSourceSpecification, LayerSpecification } from "@maptiler/sdk";
import type { FeatureCollection, Geometry } from "geojson";
import { InteractionRouter } from "../../../src/lib/core/interactions.svelte.js";
import type { Providers } from "../../../src/lib/core/plugin.js";
import { PluginHost } from "../../../src/lib/core/plugin-host.svelte.js";
import type { FormatProvider } from "../../../src/lib/data/format.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import type { MetadataProvider } from "../../../src/lib/data/metadata.js";
import type { Scale, ScaleRef } from "../../../src/lib/data/scale-types.js";
import type { MapFeatureProperties } from "../../../src/lib/data/types.js";
import { geometryBbox } from "../../../src/lib/core/shape-view.js";
import { shapesPlugin, type ShapesOptions } from "../../../src/lib/plugins/shapes.svelte.js";
import {
	colorExpression,
	FALLBACK_THEME_COLORS,
	opacityExpression
} from "../../../src/lib/plugins/style.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";
import { smokeScale } from "../../fixtures/scales.js";
import { TestSource } from "../../fixtures/sources.svelte.js";

type Props = MapFeatureProperties;

const SMOKE_REF: ScaleRef = { dataset: "smoke", entryType: "density" };

const metaSpy = vi.fn();
beforeEach(() => metaSpy.mockClear());

async function setup(
	options: Partial<ShapesOptions<Props>> & { source: TestSource<Props> },
	meta: Scale | "unavailable" | Promise<Scale> = smokeScale,
	spy = vi.fn()
) {
	const selected = new SvelteMap<string, ReadonlySet<string>>();
	const router = new InteractionRouter();
	const providers: Providers = {
		metadata: {
			scale: spy.mockImplementation(() => Promise.resolve(meta)),
			entryType: () => Promise.resolve("unavailable")
		} as unknown as MetadataProvider,
		messages: defaultMessages,
		format: {} as FormatProvider
	};
	const host = new PluginHost({
		mapUid: "m1",
		providers,
		router,
		selectedKeys: (pluginId) => selected.get(pluginId) ?? new Set()
	});
	const plugin = shapesPlugin<Props>({
		id: "shp",
		layerLabel: "Smoke",
		mode: "choropleth",
		...options
	});
	host.add(plugin);
	const gl = createFakeGl({ styleLoaded: true });
	host.attach(gl);
	await tick();
	return { host, plugin, gl, selected, router };
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	flushSync();
}

const layer = (gl: FakeGl, id: string) => gl.layers.find((l) => l.id === id)!;
const layerIds = (gl: FakeGl) => gl.layers.map((l) => l.id);

function collection(
	rows: Array<{ props: Props; geometry: Geometry }>
): FeatureCollection<Geometry, Props> {
	return {
		type: "FeatureCollection",
		features: rows.map(({ props, geometry }) => ({
			type: "Feature",
			geometry,
			properties: props
		}))
	};
}

const square = (x: number, y: number, size: number): number[][] => [
	[x, y],
	[x + size, y],
	[x + size, y + size],
	[x, y + size],
	[x, y]
];

const POLYGONS = collection([
	{
		props: { refKey: "feature:a", name: "Alpha", value: 1 },
		geometry: { type: "Polygon", coordinates: [square(0, 0, 2)] }
	},
	{
		props: { refKey: "feature:b", name: "Bravo", value: "heavy" },
		geometry: { type: "Polygon", coordinates: [square(5, 5, 2)] }
	}
]);

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	expect(errorSpy).not.toHaveBeenCalled();
	errorSpy.mockRestore();
});

describe("shapesPlugin", () => {
	it("fills by the scale in choropleth mode, with per-level opacity", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: SMOKE_REF });
		const scale = Promise.withResolvers<Scale>();
		const { gl, plugin } = await setup({ source }, scale.promise);
		expect(gl.layers).toEqual([]);
		scale.resolve(smokeScale);
		await settle();
		expect(layerIds(gl)).toEqual([
			"m1:shp:fill",
			"m1:shp:outline",
			"m1:shp:selected",
			"m1:shp:check"
		]);
		const fill = layer(gl, "m1:shp:fill") as Extract<LayerSpecification, { type: "fill" }>;
		expect(fill.paint!["fill-color"]).toEqual(
			colorExpression(smokeScale, "value", FALLBACK_THEME_COLORS.neutral)
		);
		expect(fill.paint!["fill-opacity"]).toEqual(opacityExpression(smokeScale, "value", 0.6));
		expect(gl.sources.get("m1:shp:shapes")).toMatchObject({ type: "geojson", promoteId: "refKey" });
		expect(plugin.legend!()).toEqual({
			pluginId: "shp",
			title: "Smoke",
			units: "",
			scale: smokeScale
		});
	});

	it("uses fillOpacity when no level sets an opacity", async () => {
		const flat: Scale = {
			...smokeScale,
			levels: smokeScale.levels.map((l) => ({ ...l, opacity: null }))
		};
		const source = new TestSource<Props>({ features: POLYGONS, scale: flat });
		const { gl } = await setup({ source, fillOpacity: 0.3 });
		const fill = layer(gl, "m1:shp:fill") as Extract<LayerSpecification, { type: "fill" }>;
		expect(fill.paint!["fill-opacity"]).toBe(0.3);
	});

	it("draws neutral with no scale in plain mode, and has no legend", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: SMOKE_REF });
		const { gl, plugin } = await setup({ source, mode: "plain" }, smokeScale, metaSpy);
		expect(layerIds(gl)).toEqual([
			"m1:shp:fill",
			"m1:shp:outline",
			"m1:shp:selected",
			"m1:shp:check"
		]);
		const fill = layer(gl, "m1:shp:fill") as Extract<LayerSpecification, { type: "fill" }>;
		expect(fill.paint!["fill-color"]).toBe(FALLBACK_THEME_COLORS.neutral);
		expect(fill.paint!["fill-opacity"]).toBe(0.6);
		expect(plugin.legend!()).toBeNull();
		expect(metaSpy).not.toHaveBeenCalled();
	});

	it("sets the selected state and draws a thicker highlight outline", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl, selected } = await setup({ source, selectable: true });
		selected.set("shp", new SvelteSet(["feature:a"]));
		flushSync();
		expect(gl.featureStates.get("m1:shp:shapes/feature:a")).toEqual({ selected: true });
		selected.set("shp", new SvelteSet());
		flushSync();
		expect(gl.featureStates.get("m1:shp:shapes/feature:a")?.selected).toBeUndefined();
		const outline = layer(gl, "m1:shp:outline") as Extract<LayerSpecification, { type: "line" }>;
		const sel = layer(gl, "m1:shp:selected") as Extract<LayerSpecification, { type: "line" }>;
		expect(sel.paint!["line-width"]).toBe(3);
		expect(sel.paint!["line-color"]).toBe(FALLBACK_THEME_COLORS.highlight);
		expect(sel.paint!["line-opacity"]).toEqual([
			"case",
			["boolean", ["feature-state", "selected"], false],
			1,
			0
		]);
		expect(outline.paint!["line-width"]).toEqual([
			"case",
			["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
			2,
			1
		]);
	});

	it("updates data without rebuilding layers", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl } = await setup({ source });
		const before = gl.layers.slice();
		source.features = collection([POLYGONS.features[0] as never]);
		flushSync();
		expect(gl.layers).toEqual(before);
		const data = (gl.sources.get("m1:shp:shapes") as GeoJSONSourceSpecification)
			.data as FeatureCollection;
		expect(data.features.length).toBe(1);
		expect(gl.calls).toContain("setData:m1:shp:shapes");
	});

	it("lists features with lngLat inside the largest part of a MultiPolygon", async () => {
		const multi = collection([
			{
				props: { refKey: "feature:m", name: "Multi", value: "light" },
				geometry: {
					type: "MultiPolygon",
					coordinates: [[square(0, 0, 1)], [square(10, 10, 4)]]
				}
			},
			{
				props: { refKey: "feature:l", name: "Line", value: "heavy" },
				geometry: {
					type: "LineString",
					coordinates: [
						[0, 0],
						[1, 1],
						[2, 2],
						[3, 3],
						[4, 4]
					]
				}
			}
		]);
		const source = new TestSource<Props>({ features: multi, scale: smokeScale });
		const { plugin } = await setup({ source, selectable: true });
		const items = plugin.features!();
		const [lng, lat] = items[0].lngLat;
		expect(lng).toBeGreaterThan(10);
		expect(lng).toBeLessThan(14);
		expect(lat).toBeGreaterThan(10);
		expect(lat).toBeLessThan(14);
		expect(items[1].lngLat).toEqual([2, 2]);
		expect(items[0]).toMatchObject({
			refKey: "feature:m",
			name: "Multi",
			level: smokeScale.levels[0],
			selectable: false
		});
	});

	it("items carry geometry and bbox", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { plugin } = await setup({ source });
		const [first] = plugin.features!();
		expect(first.geometry).toBe(POLYGONS.features[0].geometry);
		expect(first.bbox).toEqual(geometryBbox(POLYGONS.features[0].geometry));
	});

	it("measures each feature once", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { plugin } = await setup({ source });
		const [a] = plugin.features!();
		const [b] = plugin.features!();
		expect(b.bbox).toBe(a.bbox);
		expect(b.lngLat).toBe(a.lngLat);
	});

	it("a reload measures the new features", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { plugin } = await setup({ source });
		expect(plugin.features!()[0].bbox).toEqual([0, 0, 2, 2]);
		source.features = collection([
			{
				props: { refKey: "feature:a", name: "Alpha", value: 1 },
				geometry: { type: "Polygon", coordinates: [square(5, 5, 1)] }
			}
		]);
		flushSync();
		expect(plugin.features!()[0].bbox).toEqual([5, 5, 6, 6]);
	});

	it("omits features() when not listed", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		expect((await setup({ source, listed: false })).plugin.features).toBeUndefined();
	});

	it("default theme outline unchanged", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: SMOKE_REF });
		const { gl } = await setup({ source });
		await settle();
		const outline = layer(gl, "m1:shp:outline") as Extract<LayerSpecification, { type: "line" }>;
		expect(outline.paint!["line-color"]).toEqual([
			"case",
			["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
			colorExpression(smokeScale, "value", FALLBACK_THEME_COLORS.neutral),
			FALLBACK_THEME_COLORS.foreground
		]);
		expect(outline.paint!["line-opacity"]).toBeUndefined();
	});

	it("outline level paints line-color from the scale", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: SMOKE_REF });
		const { gl } = await setup({ source, outline: "level" });
		await settle();
		const outline = layer(gl, "m1:shp:outline") as Extract<LayerSpecification, { type: "line" }>;
		expect(outline.paint!["line-color"]).toEqual(
			colorExpression(smokeScale, "value", FALLBACK_THEME_COLORS.neutral)
		);
		expect(outline.paint!["line-opacity"]).toEqual(opacityExpression(smokeScale, "value", 0.6));
		expect(outline.paint!["line-width"]).toEqual([
			"case",
			["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
			2,
			1
		]);
	});

	it("outline level in plain mode falls back to the theme outline", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: SMOKE_REF });
		const { gl } = await setup({ source, mode: "plain", outline: "level" }, smokeScale, metaSpy);
		const outline = layer(gl, "m1:shp:outline") as Extract<LayerSpecification, { type: "line" }>;
		expect(outline.paint!["line-color"]).toBe(FALLBACK_THEME_COLORS.foreground);
		expect(outline.paint!["line-opacity"]).toBeUndefined();
	});

	it("outline none adds no outline layer and fill stays interactive", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: SMOKE_REF });
		const { gl, router } = await setup({ source, outline: "none" });
		await settle();
		expect(layerIds(gl)).toEqual(["m1:shp:fill", "m1:shp:selected", "m1:shp:check"]);
		router.attach(gl);
		gl.setRenderedFeatures([
			{
				layer: { id: "m1:shp:fill" },
				source: "m1:shp:shapes",
				properties: { refKey: "feature:a", name: "Alpha" },
				geometry: { type: "Point", coordinates: [0, 0] }
			}
		]);
		expect(router.hitsAt([0, 0])).toHaveLength(1);
	});

	it("registers the fill and outline for interaction", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl, router } = await setup({ source });
		router.attach(gl);
		gl.setRenderedFeatures([
			{
				layer: { id: "m1:shp:fill" },
				source: "m1:shp:shapes",
				properties: { refKey: "feature:a", name: "Alpha" },
				geometry: { type: "Point", coordinates: [0, 0] }
			}
		]);
		expect(router.hitsAt([0, 0])).toEqual([
			{ pluginId: "shp", ref: { kind: "feature", id: "a" }, refKey: "feature:a", name: "Alpha" }
		]);
	});

	const checkPoints = (gl: FakeGl) =>
		(
			(gl.sources.get("m1:shp:check") as GeoJSONSourceSpecification)
				.data as FeatureCollection<Geometry>
		).features.map((f) => (f.geometry as GeoJSON.Point).coordinates);

	it("draws a check mark at the label point of each selected feature", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl, selected } = await setup({ source, selectable: true });
		const check = layer(gl, "m1:shp:check") as Extract<LayerSpecification, { type: "symbol" }>;
		expect(check.layout!["icon-image"]).toBe("m1:shp:selected");
		expect(checkPoints(gl)).toEqual([]);
		selected.set("shp", new SvelteSet(["feature:a"]));
		flushSync();
		expect(checkPoints(gl)).toEqual([[1, 1]]);
		selected.set("shp", new SvelteSet());
		flushSync();
		expect(checkPoints(gl)).toEqual([]);
	});

	it("moves the check to the new label point when data is replaced", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl, selected } = await setup({ source, selectable: true });
		selected.set("shp", new SvelteSet(["feature:a"]));
		flushSync();
		source.features = collection([
			{
				props: { refKey: "feature:a", name: "Alpha", value: 1 },
				geometry: { type: "Polygon", coordinates: [square(10, 10, 2)] }
			}
		]);
		flushSync();
		expect(checkPoints(gl)).toEqual([[11, 11]]);
	});

	it("keeps a selected key absent from the data and shows it once it appears", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl, selected } = await setup({ source, selectable: true });
		selected.set("shp", new SvelteSet(["feature:late"]));
		flushSync();
		expect(gl.featureStates.get("m1:shp:shapes/feature:late")).toEqual({ selected: true });
		expect(checkPoints(gl)).toEqual([]);
		source.features = collection([
			{
				props: { refKey: "feature:late", name: "Late", value: 1 },
				geometry: { type: "Polygon", coordinates: [square(20, 20, 2)] }
			}
		]);
		flushSync();
		expect(gl.featureStates.get("m1:shp:shapes/feature:late")).toEqual({ selected: true });
		expect(checkPoints(gl)).toEqual([[21, 21]]);
	});

	it("rebuilds the layers when the scale changes by value", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl } = await setup({ source });
		const fillColor = () =>
			(layer(gl, "m1:shp:fill") as Extract<LayerSpecification, { type: "fill" }>).paint![
				"fill-color"
			];
		const first = fillColor();
		source.scale = { ...smokeScale, levels: smokeScale.levels.slice(0, 2) };
		flushSync();
		expect(layerIds(gl)).toEqual([
			"m1:shp:fill",
			"m1:shp:outline",
			"m1:shp:selected",
			"m1:shp:check"
		]);
		expect(fillColor()).not.toEqual(first);
		// An equal fresh scale does not rebuild.
		const calls = gl.calls.length;
		source.scale = { ...smokeScale, levels: smokeScale.levels.slice(0, 2) };
		flushSync();
		expect(gl.calls.slice(calls).some((c) => c.startsWith("addLayer"))).toBe(false);
	});

	it("adds no layers when the scale ref resolves to unavailable", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: SMOKE_REF });
		const { gl, plugin } = await setup({ source }, "unavailable");
		await settle();
		expect(gl.layers).toEqual([]);
		expect(plugin.legend!()).toEqual({
			pluginId: "shp",
			status: { state: "unavailable", reason: expect.any(String) }
		});
	});

	it("shows current data and selection after being attached again", async () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { host, selected } = await setup({ source, selectable: true });
		host.detach();
		source.features = collection([
			{
				props: { refKey: "feature:z", name: "Zulu", value: 1 },
				geometry: { type: "Polygon", coordinates: [square(30, 30, 2)] }
			}
		]);
		selected.set("shp", new SvelteSet(["feature:z"]));
		flushSync();
		const gl2 = createFakeGl({ styleLoaded: true });
		host.attach(gl2);
		await tick();
		const data = (gl2.sources.get("m1:shp:shapes") as GeoJSONSourceSpecification)
			.data as FeatureCollection;
		expect(data.features.map((f) => f.properties!.refKey)).toEqual(["feature:z"]);
		expect(gl2.featureStates.get("m1:shp:shapes/feature:z")).toEqual({ selected: true });
		expect(checkPoints(gl2)).toEqual([[31, 31]]);
	});
});
