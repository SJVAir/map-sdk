import { flushSync, tick } from "svelte";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import { hmsSmokePlugin } from "../../src/lib/presets/hms-smoke.js";
import MapTooltip from "../../src/lib/ui/MapTooltip.svelte";
import { createFakeGl } from "../fixtures/fake-gl.js";
import { smokeScale } from "../fixtures/scales.js";
import { TestSource } from "../fixtures/sources.svelte.js";

const plume = {
	type: "Feature" as const,
	geometry: {
		type: "Polygon" as const,
		coordinates: [
			[
				[-120, 36],
				[-119, 36],
				[-119, 37],
				[-120, 37],
				[-120, 36]
			]
		]
	},
	properties: { refKey: "feature:smoke-1", name: "Smoke", value: "medium" }
};

async function smokeMap() {
	const source = new TestSource({
		features: { type: "FeatureCollection", features: [plume] },
		scale: smokeScale
	});
	const map = createMap({ config: { maptilerKey: "test-key" } });
	map.addPlugin(hmsSmokePlugin({ source, layerLabel: "Smoke" }));
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	await tick();
	return { map, gl };
}

describe("hmsSmokePlugin tooltips", () => {
	it("hovering a plume shows no tooltip", async () => {
		const { map, gl } = await smokeMap();
		gl.setRenderedFeatures([
			{
				layer: { id: `${map.uid}:hms-smoke:fill` },
				source: `${map.uid}:hms-smoke:src`,
				properties: plume.properties,
				geometry: plume.geometry
			}
		] as never);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		flushSync();
		render(MapTooltip, { map, project: () => ({ x: 100, y: 100 }) });
		await tick();
		expect(page.getByRole("tooltip").elements()).toHaveLength(0);
		map.destroy();
	});

	it("focusing a plume from the list pins its tooltip with its density", async () => {
		const { map } = await smokeMap();
		map.focusFeature("feature:smoke-1", "hms-smoke");
		render(MapTooltip, { map, project: () => ({ x: 100, y: 100 }) });
		const tooltip = page.getByRole("tooltip");
		await expect.element(tooltip).toBeVisible();
		expect(tooltip.element().textContent).toContain("Smoke");
		expect(tooltip.element().textContent).toContain("Medium");
		map.destroy();
	});
});
