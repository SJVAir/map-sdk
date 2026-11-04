import type { LayerSpecification } from "@maptiler/sdk";
import type { FeatureCollection, Geometry } from "geojson";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import type { MetadataProvider } from "../../../src/lib/data/metadata.js";
import type { MapPlugin } from "../../../src/lib/core/plugin.js";
import type { Scale, ScaleRef } from "../../../src/lib/data/scale-types.js";
import type { MapFeatureProperties } from "../../../src/lib/data/types.js";
import { calHeatScorePlugin } from "../../../src/lib/presets/calheatscore.js";
import { forecastZonesPlugin } from "../../../src/lib/presets/forecast-zones.js";
import { regionsPlugin } from "../../../src/lib/presets/regions.js";
import { createFakeGl } from "../../fixtures/fake-gl.js";
import { heatScale } from "../../fixtures/scales.js";
import { TestSource } from "../../fixtures/sources.svelte.js";

type Props = MapFeatureProperties;
type Factory = (o: {
	id?: string;
	source: TestSource<Props>;
	layerLabel: string;
	selectable?: boolean;
}) => MapPlugin;

const PRESETS: Array<[string, Factory, string, ScaleRef]> = [
	["regionsPlugin", regionsPlugin, "regions", { dataset: "air-quality", entryType: "pm25" }],
	[
		"calHeatScorePlugin",
		calHeatScorePlugin,
		"calheatscore",
		{ dataset: "calheatscore", entryType: "heat-score" }
	],
	[
		"forecastZonesPlugin",
		forecastZonesPlugin,
		"forecast-zones",
		{ dataset: "forecasts", entryType: "aqi-forecast" }
	]
];

const ZIP: FeatureCollection<Geometry, Props> = {
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
			properties: { refKey: "region:zipcode:93721", name: "93721", value: "low" }
		}
	]
};

function setUp(factory: Factory, id: string, scale: ScaleRef | Scale | null) {
	const source = new TestSource<Props>({ features: ZIP, scale });
	const map = createMap({ config: { maptilerKey: "test-key" } });
	const onselectionchange = vi.fn();
	map.addPlugin(factory({ source, layerLabel: "Zones" }), {
		selectionMode: "single",
		onselectionchange
	});
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	flushSync();
	return { map, gl, onselectionchange, id };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	expect(errorSpy).not.toHaveBeenCalled();
	errorSpy.mockRestore();
});

describe.each(PRESETS)("%s", (_name, factory, defaultId, ref) => {
	it("has a default id, the label, and the ScaleRef's dataset", () => {
		const source = new TestSource<Props>({ scale: ref });
		const plugin = factory({ source, layerLabel: "Zones" });
		expect(plugin.id).toBe(defaultId);
		expect(plugin.label).toBe("Zones");
		expect(plugin.dataset).toBe(ref.dataset);
		expect(plugin.selectable).toBe(true);
		expect(factory({ id: "other", source, layerLabel: "x" }).id).toBe("other");
	});

	it("can be made unselectable", () => {
		const source = new TestSource<Props>({ scale: ref });
		expect(factory({ source, layerLabel: "x", selectable: false }).selectable).toBe(false);
	});

	it("fills by a match expression from the scale", () => {
		const { gl } = setUp(factory, defaultId, heatScale);
		const fill = gl.layers.find((l) => l.id.endsWith(":fill")) as Extract<
			LayerSpecification,
			{ type: "fill" }
		>;
		expect((fill.paint!["fill-color"] as unknown[])[0]).toBe("match");
	});

	it("adds no layers when the scale is unavailable", async () => {
		const source = new TestSource<Props>({ features: ZIP, scale: ref });
		const map = createMap({
			config: { maptilerKey: "test-key" },
			metadata: { scale: () => Promise.resolve("unavailable") } as unknown as MetadataProvider
		});
		map.addPlugin(factory({ source, layerLabel: "Zones" }));
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		flushSync();
		await Promise.resolve();
		await Promise.resolve();
		flushSync();
		expect(gl.layers).toEqual([]);
	});

	it("picks a ZIP feature as a regions selection", async () => {
		const { map, gl, onselectionchange } = setUp(factory, defaultId, heatScale);
		gl.setRenderedFeatures([
			{
				layer: { id: `${map.uid}:${defaultId}:fill` },
				source: `${map.uid}:${defaultId}:shapes`,
				properties: { refKey: "region:zipcode:93721", name: "93721" },
				geometry: { type: "Point" as const, coordinates: [1, 1] }
			}
		]);
		gl.emit("click", { point: { x: 1, y: 2 }, lngLat: { lng: 1, lat: 1 } });
		await Promise.resolve();
		await Promise.resolve();
		expect(onselectionchange).toHaveBeenCalledWith({ kind: "regions", ids: ["zipcode:93721"] });
	});
});
