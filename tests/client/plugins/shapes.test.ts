import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
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

function setup(
	options: Partial<ShapesOptions<Props>> & { source: TestSource<Props> },
	meta: Scale | "unavailable" = smokeScale
) {
	const selected = new SvelteMap<string, ReadonlySet<string>>();
	const router = new InteractionRouter();
	const providers: Providers = {
		metadata: { scale: vi.fn(() => Promise.resolve(meta)) } as unknown as MetadataProvider,
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
	flushSync();
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
		const { gl, plugin } = setup({ source });
		expect(gl.layers).toEqual([]);
		await settle();
		expect(layerIds(gl)).toEqual(["m1:shp:fill", "m1:shp:outline", "m1:shp:selected"]);
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

	it("uses fillOpacity when no level sets an opacity", () => {
		const flat: Scale = {
			...smokeScale,
			levels: smokeScale.levels.map((l) => ({ ...l, opacity: null }))
		};
		const source = new TestSource<Props>({ features: POLYGONS, scale: flat });
		const { gl } = setup({ source, fillOpacity: 0.3 });
		const fill = layer(gl, "m1:shp:fill") as Extract<LayerSpecification, { type: "fill" }>;
		expect(fill.paint!["fill-opacity"]).toBe(0.3);
	});

	it("draws neutral with no scale in plain mode, and has no legend", () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: SMOKE_REF });
		const { gl, plugin } = setup({ source, mode: "plain" });
		expect(layerIds(gl)).toEqual(["m1:shp:fill", "m1:shp:outline", "m1:shp:selected"]);
		const fill = layer(gl, "m1:shp:fill") as Extract<LayerSpecification, { type: "fill" }>;
		expect(fill.paint!["fill-color"]).toBe(FALLBACK_THEME_COLORS.neutral);
		expect(fill.paint!["fill-opacity"]).toBe(0.6);
		expect(plugin.legend!()).toBeNull();
	});

	it("sets the selected state and draws a thicker highlight outline", () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl, selected } = setup({ source, selectable: true });
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
		expect(JSON.stringify(outline.paint!["line-width"])).not.toContain("3");
	});

	it("updates data without rebuilding layers", () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl } = setup({ source });
		const before = gl.layers.slice();
		source.features = collection([POLYGONS.features[0] as never]);
		flushSync();
		expect(gl.layers).toEqual(before);
		const data = (gl.sources.get("m1:shp:shapes") as GeoJSONSourceSpecification)
			.data as FeatureCollection;
		expect(data.features.length).toBe(1);
		expect(gl.calls).toContain("setData:m1:shp:shapes");
	});

	it("lists features with lngLat inside the largest part of a MultiPolygon", () => {
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
		const { plugin } = setup({ source, selectable: true });
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

	it("omits features() when not listed", () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		expect(setup({ source, listed: false }).plugin.features).toBeUndefined();
	});

	it("registers the fill and outline for interaction", () => {
		const source = new TestSource<Props>({ features: POLYGONS, scale: smokeScale });
		const { gl, router } = setup({ source });
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
});
