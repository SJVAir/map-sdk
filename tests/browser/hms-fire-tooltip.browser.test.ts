import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import { hmsFirePlugin } from "../../src/lib/presets/hms-fire.js";
import MapTooltip from "../../src/lib/ui/MapTooltip.svelte";
import { createFakeGl } from "../fixtures/fake-gl.js";
import { fireScale } from "../fixtures/scales.js";
import { points, TestSource } from "../fixtures/sources.svelte.js";

describe("hmsFirePlugin hotspot tooltips", () => {
	it("a hovered hotspot shows its name, value, and level like a group", async () => {
		const row = (refKey: string, value: number) => ({ refKey, name: "Fire", value });
		const groups = new TestSource({ features: points([row("feature:g1", 45)]), scale: fireScale });
		const hotspots = new TestSource({
			features: points([row("feature:h1", 200)]),
			scale: fireScale
		});
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(hmsFirePlugin({ source: groups, hotspots, layerLabel: "Fires" }));
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		flushSync();
		const id = (local: string) => `${map.uid}:hms-fire:${local}`;
		gl.setRenderedFeatures([
			{
				layer: { id: id("hotspots:points") },
				source: id("hotspots:points"),
				properties: row("feature:h1", 200),
				geometry: { type: "Point", coordinates: [0, 0] }
			}
		] as never);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		flushSync();
		render(MapTooltip, { map, project: () => ({ x: 100, y: 100 }) });
		const tooltip = page.getByRole("tooltip");
		await expect.element(tooltip).toBeVisible();
		await expect
			.poll(() => tooltip.element().textContent!.replace(/\s+/g, " ").trim())
			.toBe("Fire 200 MW 150–349");
		// The groups are the only listed fires.
		expect(map.plugins[0].features?.().map((f) => f.refKey)).toEqual(["feature:g1"]);
		map.destroy();
	});
});
