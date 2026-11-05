import {
	createExpression,
	createPropertyExpression,
	latest
} from "@maplibre/maplibre-gl-style-spec";
import type { GeoJSONSourceSpecification, LayerSpecification } from "@maptiler/sdk";
import { darken } from "color2k";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import { applyPick } from "../../../src/lib/data/selection.js";
import type { MonitorFeatureProperties } from "../../../src/lib/data/types.js";
import {
	MONITOR_INACTIVE_COLOR,
	MONITOR_INSIDE_OUTLINE,
	monitorShape,
	monitorsPlugin
} from "../../../src/lib/presets/monitors.js";
import { FALLBACK_THEME_COLORS } from "../../../src/lib/plugins/style.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";
import { monitor, MONITORS } from "../../fixtures/monitors.js";
import { pm25Scale } from "../../fixtures/scales.js";
import { points, TestSource } from "../../fixtures/sources.svelte.js";

vi.mock("../../../src/lib/data/selection.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../src/lib/data/selection.js")>();
	return { ...actual, applyPick: vi.fn(actual.applyPick) };
});

type Symbol = Extract<LayerSpecification, { type: "symbol" }>;

/** Evaluates a data expression for a feature with `properties`. */
function evaluate(expr: unknown, properties: Record<string, unknown>, type = "string"): unknown {
	const result = createExpression(expr, { type } as never);
	if (result.result !== "success") throw new Error(JSON.stringify(result.value));
	return result.value.evaluate({ zoom: 0 }, { type: 1, properties } as never);
}

/** The rendered cluster feature MapLibre reports for a bubble. */
function clusterFeature(layerId: string, clusterId: number, props: Record<string, unknown> = {}) {
	return {
		layer: { id: layerId },
		source: "",
		properties: { cluster: true, cluster_id: clusterId, point_count: 2, ...props },
		geometry: { type: "Point" as const, coordinates: [-119.5, 36.5] }
	};
}

function setUp(rows: MonitorFeatureProperties[] = MONITORS, clustered?: boolean) {
	const source = new TestSource<MonitorFeatureProperties>({
		features: points(rows),
		scale: pm25Scale
	});
	const map = createMap({ config: { maptilerKey: "test-key" } });
	const plugin = monitorsPlugin({ source, layerLabel: "Monitors", selectable: true, clustered });
	const onselectionchange = vi.fn();
	map.addPlugin(plugin, { selectionMode: "single", onselectionchange });
	const gl = createFakeGl({ styleLoaded: true });
	// The parts of a clustered GeoJSONSource the preset uses.
	const expansionZoom = vi.fn(async () => 11);
	const leaves = vi.fn(async () => []);
	const getSource = gl.getSource.bind(gl);
	gl.getSource = (id: string) => {
		const found = getSource(id) as object | undefined;
		return found && { ...found, getClusterExpansionZoom: expansionZoom, getClusterLeaves: leaves };
	};
	map.attach(gl);
	flushSync();
	const id = (local: string) => `${map.uid}:monitors:${local}`;
	return { map, gl, plugin, source, onselectionchange, expansionZoom, id };
}

const layer = (gl: FakeGl, id: string) => gl.layers.find((l) => l.id === id)!;
const sourceData = (gl: FakeGl, id: string) =>
	(gl.sources.get(id) as GeoJSONSourceSpecification).data as GeoJSON.FeatureCollection;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	vi.mocked(applyPick).mockClear();
});
afterEach(() => {
	expect(errorSpy).not.toHaveBeenCalled();
	errorSpy.mockRestore();
	vi.unstubAllGlobals();
});

describe("monitorShape", () => {
	it("draws reference monitors as triangles and sensors as circles", () => {
		for (const type of ["airnow", "aqview", "bam1022", "aqlite"]) {
			expect(monitorShape(type)).toBe("triangle");
		}
		for (const type of ["purpleair", "airgradient", "vozbox"]) {
			expect(monitorShape(type)).toBe("circle");
		}
	});

	it("falls back to a circle for an unknown type", () => {
		expect(monitorShape("somethingnew")).toBe("circle");
	});
});

describe("monitorsPlugin", () => {
	it("is named monitors, labeled, and attributed to its ScaleRef's dataset", () => {
		const source = new TestSource<MonitorFeatureProperties>({
			scale: { dataset: "air-quality", entryType: "pm25" }
		});
		const plugin = monitorsPlugin({ source, layerLabel: "Air monitors" });
		expect(plugin.id).toBe("monitors");
		expect(plugin.label).toBe("Air monitors");
		expect(plugin.dataset).toBe("air-quality");
		expect(monitorsPlugin({ id: "other", source, layerLabel: "x" }).id).toBe("other");
	});

	it("is selectable by default, unless turned off", () => {
		const source = new TestSource<MonitorFeatureProperties>({ features: points(MONITORS) });
		expect(monitorsPlugin({ source, layerLabel: "x" }).selectable).toBe(true);
		expect(monitorsPlugin({ source, layerLabel: "x", selectable: false }).selectable).toBe(false);
	});

	it("adds one clustered source per monitor type, radius 40 up to zoom 9, summing values", () => {
		const { gl, id } = setUp();
		const clustered = [...gl.sources.keys()].filter((key) => key.startsWith(id("points:")));
		expect(clustered.sort()).toEqual(
			[id("points:airgradient"), id("points:airnow"), id("points:purpleair")].sort()
		);
		for (const key of clustered) {
			const spec = gl.sources.get(key) as GeoJSONSourceSpecification;
			expect(spec).toMatchObject({ cluster: true, clusterRadius: 40, clusterMaxZoom: 9 });
			expect(Object.keys(spec.clusterProperties as object)).toContain("sumValues");
		}
		expect(sourceData(gl, id("points:purpleair")).features).toHaveLength(3);
	});

	it("counts numbers and numeric strings toward the cluster average, as levels do", () => {
		const { gl, id } = setUp();
		const spec = gl.sources.get(id("points:airnow")) as GeoJSONSourceSpecification;
		const { sumValues, countValues } = spec.clusterProperties as Record<string, unknown[]>;
		const each = (value: unknown) => [
			evaluate(sumValues[1], { value }, "number"),
			evaluate(countValues[1], { value }, "number")
		];
		expect(each(12)).toEqual([12, 1]);
		expect(each("12.5")).toEqual([12.5, 1]);
		expect(each("")).toEqual([0, 0]);
		expect(each(" ")).toEqual([0, 0]);
		expect(each("n/a")).toEqual([0, 0]);
		expect(each(null)).toEqual([0, 0]);
	});

	it("evaluates every layer without expression warnings for null readings and empty clusters", () => {
		const { gl } = setUp([
			monitor("1", "purpleair", null),
			monitor("2", "airnow", null, { isActive: false }),
			monitor("3", "purpleair", "", { location: "inside" }),
			monitor("4", "airgradient", 12)
		]);
		const features: Array<Record<string, unknown>> = [];
		for (const spec of gl.sources.values()) {
			const data = (spec as GeoJSONSourceSpecification).data as GeoJSON.FeatureCollection;
			for (const f of data.features ?? []) features.push(f.properties ?? {});
		}
		// What MapLibre gives a cluster: its count and the reduced cluster properties.
		features.push(
			{ cluster: true, cluster_id: 1, point_count: 2, sumValues: 0, countValues: 0 },
			{ cluster: true, cluster_id: 2, point_count: 30, sumValues: 31, countValues: 3 }
		);
		// MapLibre warns (once per expression) instead of throwing when evaluation fails.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const specs = latest as unknown as Record<string, Record<string, unknown>>;
		let evaluated = 0;
		for (const layer of gl.layers) {
			const filter = "filter" in layer && layer.filter ? layer.filter : true;
			const passes = createExpression(filter, { type: "boolean" } as never);
			if (passes.result !== "success") throw new Error(JSON.stringify(passes.value));
			for (const group of ["layout", "paint"] as const) {
				const props = (layer as Record<string, unknown>)[group] as Record<string, unknown>;
				for (const [key, value] of Object.entries(props ?? {})) {
					if (!Array.isArray(value)) continue;
					const expr = createPropertyExpression(
						value,
						specs[`${group}_${layer.type}`][key] as never
					);
					if (expr.result !== "success") throw new Error(JSON.stringify(expr.value));
					for (const properties of features) {
						const feature = { type: 1, properties } as never;
						if (!passes.value.evaluate({ zoom: 7 }, feature)) continue;
						expr.value.evaluate({ zoom: 7 }, feature);
						evaluated++;
					}
				}
			}
		}
		expect(evaluated).toBeGreaterThan(20);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	it("draws types in monitor-map's order, SJVAir PurpleAir above other PurpleAir", () => {
		const { gl, id } = setUp();
		const points = gl.layers.map((l) => l.id).filter((l) => l.startsWith(id("points:")));
		// Highest order per type: airnow 2, purpleair 4 (an SJVAir one), airgradient 5.
		expect(points).toEqual([id("points:airnow"), id("points:purpleair"), id("points:airgradient")]);
		const keys = sourceData(gl, id("points:purpleair")).features.map(
			(f) => f.properties!["mapsdk:sortKey"]
		);
		expect(keys).toEqual([4, 1, 1]);
	});

	it("colors a cluster by its average with the type's shape and shows the rounded average", () => {
		const { gl, id } = setUp();
		const icons = layer(gl, id("cluster-icon:airnow")) as Symbol;
		const text = layer(gl, id("cluster-average:airnow")) as Symbol;
		const cluster = { point_count: 3, sumValues: 31, countValues: 3 };
		expect(evaluate(icons.layout!["icon-image"], cluster)).toBe(
			`${id("icon:0:")}triangle:outside:moderate`
		);
		expect(evaluate(text.layout!["text-field"], cluster)).toBe("10");
		// The unrounded average picks the level: 9.12 shows as 9 but is Moderate (from 9.1).
		const boundary = { point_count: 2, sumValues: 18.24, countValues: 2 };
		expect(evaluate(icons.layout!["icon-image"], boundary)).toBe(
			`${id("icon:0:")}triangle:outside:moderate`
		);
		expect(evaluate(text.layout!["text-field"], boundary)).toBe("9");
		// No numeric values: the neutral image and no number.
		const empty = { point_count: 2, sumValues: 0, countValues: 0 };
		expect(evaluate(icons.layout!["icon-image"], empty)).toBe(`${id("icon:0:")}triangle:outside:`);
		expect(evaluate(text.layout!["text-field"], empty)).toBe("");
		expect(icons.paint!["icon-opacity"]).toBe(0.8);
		expect(evaluate(icons.layout!["icon-size"], { point_count: 30 }, "number")).toBe(1);
	});

	it("zooms into a clicked cluster and never picks through it", async () => {
		const handler = vi.fn();
		const { map, gl, id, onselectionchange, expansionZoom } = setUp();
		map.on("featureclick", handler);
		const bubble = clusterFeature(id("cluster-icon:purpleair"), 7);
		const beneath = {
			layer: { id: id("points:airnow") },
			source: id("points:airnow"),
			properties: { refKey: "monitor:3", name: "Monitor 3" },
			geometry: { type: "Point" as const, coordinates: [-119.5, 36.5] }
		};
		gl.setRenderedFeatures([bubble, beneath]);
		const event = {
			point: { x: 1, y: 2 },
			lngLat: { lng: -119.5, lat: 36.5 },
			originalEvent: {}
		};
		gl.emit("click", event);
		await Promise.resolve();
		await Promise.resolve();
		expect(applyPick).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(expansionZoom).toHaveBeenCalledTimes(1);
		expect(expansionZoom).toHaveBeenCalledWith(7);
		expect(gl.calls.filter((c) => c === "easeTo")).toHaveLength(1);
		expect(gl.getZoom()).toBe(11);
		expect(gl.getCenter()).toEqual({ lng: -119.5, lat: 36.5 });
	});

	it("picks a monitor drawn above a cluster and doesn't zoom", async () => {
		const handler = vi.fn();
		const { map, gl, id, expansionZoom } = setUp();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([
			{
				layer: { id: id("points:airgradient") },
				source: id("points:airgradient"),
				properties: { refKey: "monitor:4", name: "Monitor 4" },
				geometry: { type: "Point" as const, coordinates: [-119.5, 36.5] }
			},
			clusterFeature(id("cluster-icon:purpleair"), 7)
		]);
		gl.emit("click", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		await Promise.resolve();
		await Promise.resolve();
		expect(handler).toHaveBeenCalledWith({
			pluginId: "monitors",
			ref: { kind: "monitor", id: "4" },
			lngLat: [-119.5, 36.5]
		});
		expect(expansionZoom).not.toHaveBeenCalled();
		expect(gl.calls).not.toContain("easeTo");
		// No layer-scoped click listener that could zoom anyway.
		expect(gl.listeners.filter((l) => l.layerId !== undefined)).toEqual([]);
	});

	it("zooms into a cluster with no animation under reduced motion", async () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }));
		const { gl, id } = setUp();
		const easeTo = vi.spyOn(gl, "easeTo");
		gl.setRenderedFeatures([clusterFeature(id("cluster-icon:airnow"), 3)]);
		gl.emit("click", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		await Promise.resolve();
		await Promise.resolve();
		expect(easeTo).toHaveBeenCalledWith({ center: [-119.5, 36.5], zoom: 11, duration: 0 });
	});

	it("hovers the cluster itself, with its own tooltip, not a feature beneath", () => {
		const { map, gl, plugin, id } = setUp();
		gl.setRenderedFeatures([
			clusterFeature(id("cluster-icon:purpleair"), 7, { sumValues: 44, countValues: 2 }),
			{
				layer: { id: id("points:airnow") },
				source: id("points:airnow"),
				properties: { refKey: "monitor:3", name: "Monitor 3" },
				geometry: { type: "Point", coordinates: [-119.5, 36.5] }
			}
		]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		const hit = map.hovered!.hit;
		expect(hit.pluginId).toBe("monitors");
		expect(hit.ref.kind).toBe("feature");
		expect(plugin.features!().some((f) => f.refKey === hit.refKey)).toBe(false);
		expect(hit.properties).toMatchObject({ cluster_id: 7, sumValues: 44, countValues: 2 });
		expect(plugin.hoverTooltip!(hit)).toBeTypeOf("function");
		expect(plugin.tooltip!(plugin.features!()[0])).toBeTypeOf("function");
	});

	it("gives no cluster content once the data the hover came from is replaced", () => {
		const { map, gl, plugin, source, id } = setUp();
		gl.setRenderedFeatures([clusterFeature(id("cluster-icon:purpleair"), 7)]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		const stale = map.hovered!.hit;
		expect(plugin.hoverTooltip!(stale)).toBeTypeOf("function");
		source.features = points(MONITORS.slice(0, 3));
		flushSync();
		expect(plugin.hoverTooltip!(stale)).toBeUndefined();
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered!.hit.refKey).not.toBe(stale.refKey);
		expect(plugin.hoverTooltip!(map.hovered!.hit)).toBeTypeOf("function");
	});

	it("leaves plugin state alone on lookups over a cluster", () => {
		const { map, gl, plugin, id } = setUp();
		gl.setRenderedFeatures([clusterFeature(id("cluster-icon:purpleair"), 7)]);
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([]);
		expect(map.hovered).toBeNull();
		// A hit made up from a lookup that never hovered still works: nothing was remembered.
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(plugin.hoverTooltip!(map.hovered!.hit)).toBeTypeOf("function");
	});

	it("inactive monitor image is drawn #969696 whatever the value and the theme", () => {
		const svgs: string[] = [];
		class FakeImage {
			onload: (() => void) | null = null;
			set src(v: string) {
				svgs.push(decodeURIComponent(v.replace(/^data:image\/svg\+xml;utf8,/, "")));
			}
		}
		vi.stubGlobal("Image", FakeImage);
		const { gl, id } = setUp();
		const icons = layer(gl, id("points:airgradient")) as Symbol;
		const [inactive] = sourceData(gl, id("points:airgradient")).features;
		expect(inactive.properties!.isActive).toBe(false);
		expect(evaluate(icons.layout!["icon-image"], inactive.properties!)).toBe(
			`${id("icon:0:")}circle:outside:mapsdk:muted`
		);
		expect(MONITOR_INACTIVE_COLOR).toBe("#969696");
		expect(FALLBACK_THEME_COLORS.mutedForeground).not.toBe(MONITOR_INACTIVE_COLOR);
		expect(svgs.some((svg) => svg.includes(`fill="${MONITOR_INACTIVE_COLOR}"`))).toBe(true);
		expect(
			svgs.some((svg) => svg.includes(`fill="${FALLBACK_THEME_COLORS.mutedForeground}"`))
		).toBe(false);
		const active = sourceData(gl, id("points:purpleair")).features[1];
		expect(evaluate(icons.layout!["icon-image"], active.properties!)).toBe(
			`${id("icon:0:")}circle:outside:unhealthy_sensitive`
		);
	});

	it("inside outline is black in a dark theme", () => {
		const svgs = new Map<string, string>();
		class FakeImage {
			onload: (() => void) | null = null;
			set src(v: string) {
				svgs.set(v, decodeURIComponent(v.replace(/^data:image\/svg\+xml;utf8,/, "")));
			}
		}
		vi.stubGlobal("Image", FakeImage);
		const { gl, id } = setUp([
			monitor("1", "purpleair", 4),
			monitor("2", "purpleair", 4, { location: "inside" })
		]);
		const icons = layer(gl, id("points:purpleair")) as Symbol;
		const [, inside] = sourceData(gl, id("points:purpleair")).features;
		expect(evaluate(icons.layout!["icon-image"], inside.properties!)).toBe(
			`${id("icon:0:")}circle:inside:good`
		);
		const good = [...svgs.values()].filter((svg) => svg.includes('fill="#00e400"'));
		// Outside: the fill darkened; inside: black, whatever the theme.
		expect(good).toHaveLength(2);
		expect(good.filter((svg) => svg.includes(`stroke="${darken("#00e400", 0.1)}"`))).toHaveLength(
			1
		);
		expect(MONITOR_INSIDE_OUTLINE).toBe("#000000");
		// The stroke goes through darken(), which writes black as #000.
		const outline = darken(MONITOR_INSIDE_OUTLINE, 0.1);
		expect(good.filter((svg) => svg.includes(`stroke="${outline}"`))).toHaveLength(1);
		expect(darken(FALLBACK_THEME_COLORS.foreground, 0.1)).not.toBe(outline);
	});

	it("draws unclustered when clustered is false", () => {
		const { gl, id } = setUp(MONITORS, false);
		const spec = gl.sources.get(id("points")) as GeoJSONSourceSpecification;
		expect(spec.cluster).toBeUndefined();
		expect(sourceData(gl, id("points")).features).toHaveLength(MONITORS.length);
		expect(gl.layers.some((l) => l.id.includes("cluster"))).toBe(false);
	});
});
