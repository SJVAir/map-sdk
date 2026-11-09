import { flushSync, tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { FeatureCollection, Geometry } from "geojson";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import type { MapFeatureProperties } from "../../src/lib/data/types.js";
import { hmsSmokePlugin } from "../../src/lib/presets/hms-smoke.js";
import FeatureList from "../../src/lib/ui/FeatureList.svelte";
import MapTooltip from "../../src/lib/ui/MapTooltip.svelte";
import { createFakeGl } from "../fixtures/fake-gl.js";
import { plumeFeature } from "../fixtures/plume.js";
import { smokeScale } from "../fixtures/scales.js";
import { TestSource } from "../fixtures/sources.svelte.js";

const VIEW = { west: -122.5125, south: 35.29375, east: -116.8875, north: 38.10625 };

async function smokeMap() {
	const plume = plumeFeature();
	const features: FeatureCollection<Geometry, MapFeatureProperties> = {
		type: "FeatureCollection",
		features: [plume]
	};
	const source = new TestSource<MapFeatureProperties>({ features, scale: smokeScale });
	const map = createMap({ config: { maptilerKey: "test-key" } });
	map.addPlugin(hmsSmokePlugin({ source, layerLabel: "Smoke" }));
	map.attach(createFakeGl({ styleLoaded: true }));
	await tick();
	map.updateView(map.camera, VIEW);
	flushSync();
	return { map, plume };
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("a smoke plume's density", () => {
	it("is read once in its list row", async () => {
		const { map } = await smokeMap();
		render(FeatureList, { map });
		const row = page.getByRole("option", { name: "Smoke, Light" });
		await expect.element(row).toBeInTheDocument();
		const text = row.element().textContent ?? "";
		expect(text).not.toMatch(/light/);
		expect(text.match(/Light/g)).toHaveLength(1);
		map.destroy();
	});

	it("is shown once in its tooltip", async () => {
		const { map, plume } = await smokeMap();
		render(MapTooltip, { map, project: () => ({ x: 400, y: 300 }), width: 800, height: 600 });
		map.focusFeature(plume.properties.refKey, "hms-smoke");
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		const text = page.getByRole("tooltip").element().textContent ?? "";
		expect(text).not.toMatch(/light/);
		expect(text.match(/Light/g)).toHaveLength(1);
		map.destroy();
	});
});
