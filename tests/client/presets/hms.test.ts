import { createExpression } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification } from "@maptiler/sdk";
import type { FeatureCollection, Geometry } from "geojson";
import { flushSync } from "svelte";
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
	const ref = { dataset: "hms", entryType: "smoke-density" };

	it("has defaults, is not selectable, and lists nothing", () => {
		const source = new TestSource<Props>({ features: SMOKE, scale: ref });
		const plugin = hmsSmokePlugin({ source, layerLabel: "Smoke" });
		expect(plugin.id).toBe("hms-smoke");
		expect(plugin.label).toBe("Smoke");
		expect(plugin.dataset).toBe("hms");
		expect(plugin.selectable).toBe(false);
		expect(plugin.features).toBeUndefined();
		expect(hmsSmokePlugin({ id: "x", source, layerLabel: "S" }).id).toBe("x");
	});

	it("fills by density and uses each level's opacity", () => {
		const source = new TestSource<Props>({ features: SMOKE, scale: smokeScale });
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(hmsSmokePlugin({ source, layerLabel: "Smoke" }));
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		flushSync();
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

describe("hmsFirePlugin", () => {
	const ref = { dataset: "hms", entryType: "fire-frp" };

	it("has defaults, is not selectable, and lists its fires", () => {
		const source = new TestSource<Props>({
			features: points([{ refKey: "feature:f1", name: "Fire", value: 45 }]),
			scale: ref
		});
		const plugin = hmsFirePlugin({ source, layerLabel: "Fire" });
		expect(plugin.id).toBe("hms-fire");
		expect(plugin.label).toBe("Fire");
		expect(plugin.dataset).toBe("hms");
		expect(plugin.selectable).toBe(false);
		expect(plugin.features).toBeTypeOf("function");
		expect(hmsFirePlugin({ id: "x", source, layerLabel: "F" }).id).toBe("x");
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
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		flushSync();
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
