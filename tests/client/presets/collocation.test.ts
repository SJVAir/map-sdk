import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification } from "@maptiler/sdk";
import { darken } from "color2k";
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import type {
	CollocationFeatureProperties,
	MonitorFeatureProperties
} from "../../../src/lib/data/types.js";
import { withCrosshair } from "../../../src/lib/plugins/icons.js";
import {
	COLLOCATION_CROSSHAIR_COLOR,
	collocationSitesPlugin
} from "../../../src/lib/presets/collocation-sites.js";
import {
	MONITOR_INACTIVE_COLOR,
	MONITOR_INSIDE_OUTLINE,
	monitorsPlugin
} from "../../../src/lib/presets/monitors.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";
import { monitor } from "../../fixtures/monitors.js";
import { pm25Scale } from "../../fixtures/scales.js";
import { points, TestSource } from "../../fixtures/sources.svelte.js";

type Props = CollocationFeatureProperties;
type Symbol = Extract<LayerSpecification, { type: "symbol" }>;

function site(id: string, extra: Partial<Props> = {}): Props {
	return {
		...monitor(`ref-${id}`, "airnow", 12),
		refKey: `feature:${id}`,
		name: `Site ${id}`,
		colocatedId: `col-${id}`,
		colocatedName: `Monitor col-${id}`,
		colocatedType: "purpleair",
		colocatedValue: 14,
		colocatedTimestamp: "2026-11-03T21:02:00Z",
		...extra
	};
}

function evaluate(expr: unknown, properties: Record<string, unknown>, type = "string"): unknown {
	const result = createExpression(expr, { type } as never);
	if (result.result !== "success") throw new Error(JSON.stringify(result.value));
	return result.value.evaluate({ zoom: 0 }, { type: 1, properties } as never);
}

function setUp(rows: Props[] = [site("a")], withMonitors = false) {
	const map = createMap({ config: { maptilerKey: "test-key" } });
	const source = new TestSource<Props>({ features: points(rows), scale: pm25Scale });
	const plugin = collocationSitesPlugin({ source, layerLabel: "Collocation sites" });
	// Collocations register first, so they draw under monitors.
	map.addPlugin(plugin);
	if (withMonitors) {
		const monitors = new TestSource<MonitorFeatureProperties>({
			features: points([monitor("1", "purpleair", 4)]),
			scale: pm25Scale
		});
		map.addPlugin(monitorsPlugin({ source: monitors, layerLabel: "Monitors", clustered: false }));
	}
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	flushSync();
	return { map, gl, plugin, source };
}

const pointLayer = (gl: FakeGl, pluginId: string) =>
	gl.layers.find((l) => l.id.includes(`:${pluginId}:points`))! as Symbol;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	expect(errorSpy).not.toHaveBeenCalled();
	errorSpy.mockRestore();
	vi.unstubAllGlobals();
});

describe("collocationSitesPlugin", () => {
	it("collocation icon wraps the reference shape in the crosshair color", () => {
		const svgs: Array<{ svg: string; width: number }> = [];
		class FakeImage {
			onload: (() => void) | null = null;
			constructor(public width = 0) {}
			set src(v: string) {
				svgs.push({
					svg: decodeURIComponent(v.replace(/^data:image\/svg\+xml;utf8,/, "")),
					width: this.width
				});
			}
		}
		vi.stubGlobal("Image", FakeImage);
		const { gl, map } = setUp([site("a"), site("b", { type: "purpleair", location: "inside" })]);
		expect(COLLOCATION_CROSSHAIR_COLOR).toBe("#4A5FC6");
		const icons = pointLayer(gl, "collocation-sites");
		const prefix = `${map.uid}:collocation-sites:icon:0:`;
		expect(evaluate(icons.layout!["icon-image"], { ...site("a"), "mapsdk:category": "x" })).toMatch(
			new RegExp(`^${prefix}`)
		);
		// The reference monitor's shape (a triangle for airnow, a circle for purpleair) in its level
		// color, inside the crosshair, at monitor-map's 56px crosshair size.
		const moderate = svgs.filter(({ svg }) => svg.includes('fill="#ffff00"'));
		expect(moderate.some(({ svg }) => svg.includes("<polygon"))).toBe(true);
		expect(moderate.some(({ svg }) => svg.includes("<circle"))).toBe(true);
		// Every marker image; the selection overlay is drawn apart.
		const markers = svgs.filter(({ svg }) => !svg.includes('fill="none"'));
		expect(markers.length).toBeGreaterThan(0);
		for (const { svg, width } of markers) {
			expect(svg).toContain(`fill="${COLLOCATION_CROSSHAIR_COLOR}"`);
			expect(svg).toMatch(/^<svg width="56" height="56"/);
			expect(width).toBe(112);
		}
		// Inside monitors keep their black outline; inactive ones are gray.
		expect(
			svgs.some(({ svg }) => svg.includes(`stroke="${darken(MONITOR_INSIDE_OUTLINE, 0.1)}"`))
		).toBe(true);
		expect(svgs.some(({ svg }) => svg.includes(`fill="${MONITOR_INACTIVE_COLOR}"`))).toBe(true);
	});

	it("withCrosshair puts the marker in the middle of a 56px crosshair", () => {
		const svg = withCrosshair('<svg width="24" height="24"></svg>', "#123456");
		expect(svg).toMatch(/^<svg width="56" height="56" viewBox="0 0 56 56"/);
		expect(svg).toContain('<svg x="16" y="16" width="24"');
		expect(svg).toContain('fill="#123456" stroke="#123456"');
	});

	it("collocation hover wins over a monitor drawn above", () => {
		const { map, gl, plugin } = setUp([site("a")], true);
		expect(plugin.hoverPriority).toBe(Number.MAX_SAFE_INTEGER);
		const monitorLayer = pointLayer(gl, "monitors").id;
		const siteLayer = pointLayer(gl, "collocation-sites").id;
		// The monitor is topmost (first), the site beneath it.
		gl.setRenderedFeatures([
			{
				layer: { id: monitorLayer },
				source: monitorLayer,
				properties: { refKey: "monitor:1", name: "Monitor 1" },
				geometry: { type: "Point" as const, coordinates: [-119, 36.5] }
			},
			{
				layer: { id: siteLayer },
				source: siteLayer,
				properties: { refKey: "feature:a", name: "Site a" },
				geometry: { type: "Point" as const, coordinates: [-119, 36.5] }
			}
		]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119, lat: 36.5 } });
		expect(map.hovered?.hit.pluginId).toBe("collocation-sites");
		// Clicks still go to the topmost.
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.emit("click", { point: { x: 1, y: 2 }, lngLat: { lng: -119, lat: 36.5 } });
		expect(handler).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "monitors" }));
	});

	it("not selectable", () => {
		const { plugin, source } = setUp();
		expect(plugin.id).toBe("collocation-sites");
		expect(plugin.selectable).toBe(false);
		expect(plugin.label).toBe("Collocation sites");
		const items = plugin.features!();
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ refKey: "feature:a", name: "Site a", selectable: false });
		expect(collocationSitesPlugin({ id: "c", source, layerLabel: "C" }).id).toBe("c");
	});

	it("has a tooltip for a site, with or without readings", () => {
		const { plugin } = setUp([site("a"), site("b", { value: null, colocatedValue: null })]);
		for (const item of plugin.features!()) {
			expect(plugin.tooltip!(item)).toBeTypeOf("function");
		}
	});
});

describe("collocationSitesPlugin legend", () => {
	it("contributes no legend section, only a loading or failure status", () => {
		const { plugin, source } = setUp();
		expect(plugin.legend!()).toBeNull();
		const error = { state: "error" as const, error: new Error("x"), retry: () => {} };
		source.status = error;
		expect(plugin.legend!()).toEqual({ pluginId: "collocation-sites", status: error });
	});
});
