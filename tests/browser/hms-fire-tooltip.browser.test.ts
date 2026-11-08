import { flushSync, tick } from "svelte";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import type { FeatureListItem } from "../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../src/lib/data/format.js";
import { defaultMessages } from "../../src/lib/data/messages.js";
import { NO_LEVEL } from "../../src/lib/data/scale.js";
import FireTooltip from "../../src/lib/presets/FireTooltip.svelte";
import { hmsFirePlugin } from "../../src/lib/presets/hms-fire.js";
import MapTooltip from "../../src/lib/ui/MapTooltip.svelte";
import { createFakeGl } from "../fixtures/fake-gl.js";
import { fireScale } from "../fixtures/scales.js";
import { points, TestSource } from "../fixtures/sources.svelte.js";

describe("hmsFirePlugin hotspot tooltips", () => {
	it("a hovered hotspot shows the reading box, its name, and level", async () => {
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
		await tick();
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
			// A Scale object has no catalog precision, so a range scale shows whole numbers here.
			.toBe("Fire (MW) 200 Fire 150–349 MW");
		// The groups are the only listed fires.
		expect(map.plugins[0].features?.().map((f) => f.refKey)).toEqual(["feature:g1"]);
		map.destroy();
	});
});

const format = createDefaultFormat("America/Los_Angeles");

function fire(value: number, name: string, extra: Partial<FeatureListItem> = {}): FeatureListItem {
	return {
		refKey: "feature:g1",
		ref: { kind: "feature", id: "g1" },
		name,
		value,
		level: fireScale.levels.find((l) => value >= l.min! && (l.max === null || value < l.max))!,
		units: "MW",
		precision: 1,
		truncate: true,
		lngLat: [-119.7, 36.7],
		selectable: false,
		...extra
	};
}

const text = () => document.body.textContent!.replace(/\s+/g, " ").trim();

describe("FireTooltip", () => {
	it("a group shows the box: title, cut-off average in its level color, Average, name, level", async () => {
		render(FireTooltip, {
			item: fire(62.47, "3 fire detections"),
			count: 3,
			messages: defaultMessages,
			format
		});
		expect(text()).toBe("Fire (MW) 62.4 Average 3 fire detections 50–149 MW");
		const box = page.getByText("62.4").element().parentElement!;
		expect(getComputedStyle(box).backgroundColor).toBe("rgb(255, 69, 0)");
	});

	it("a group of 1 names its count and has no Average", async () => {
		render(FireTooltip, {
			item: fire(5, "1 fire detection"),
			count: 1,
			messages: defaultMessages,
			format
		});
		expect(text()).toBe("Fire (MW) 5.0 1 fire detection <10 MW");
	});

	it("a hotspot shows no Average", async () => {
		render(FireTooltip, {
			item: fire(0.7, "Fire detection"),
			count: null,
			messages: defaultMessages,
			format
		});
		expect(text()).toBe("Fire (MW) 0.7 Fire detection <10 MW");
	});

	it("cuts off at a level boundary: 9.96 shows 9.9 beside <10 MW", async () => {
		render(FireTooltip, {
			item: fire(9.96, "2 fire detections"),
			count: 2,
			messages: defaultMessages,
			format
		});
		expect(text()).toBe("Fire (MW) 9.9 Average 2 fire detections <10 MW");
	});

	it("a level with no units has no trailing space", async () => {
		render(FireTooltip, {
			item: fire(5, "Fire detection", { units: "" }),
			count: null,
			messages: defaultMessages,
			format
		});
		expect(page.getByText("<10").element().textContent).toBe("<10");
	});

	it("without a scale yet: neutral box, header Fire, No level", async () => {
		render(FireTooltip, {
			item: fire(12, "Fire detection", { level: NO_LEVEL, units: "", precision: undefined }),
			count: null,
			messages: defaultMessages,
			format
		});
		expect(text()).toBe("Fire 12 Fire detection No level");
	});
});
