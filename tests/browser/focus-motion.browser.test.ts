import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { cdp, page, userEvent } from "vitest/browser";
import axe from "axe-core";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { MapPlugin } from "../../src/lib/core/plugin.js";
import FeatureList from "../../src/lib/ui/FeatureList.svelte";
import MapControls from "../../src/lib/ui/MapControls.svelte";
import { pm25Scale } from "../fixtures/scales.js";

const root = document.documentElement.style;
const TOKENS = ["--background", "--foreground", "--ring", "--ring-edge", "--border"];

afterEach(async () => {
	for (const token of TOKENS) root.removeProperty(token);
	await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

function newMap() {
	return createMap({ config: { maptilerKey: "k" } });
}

const gl = { getZoom: () => 7, easeTo: () => {} } as unknown as GlMapLike;

function listPlugin(): MapPlugin {
	return {
		id: "monitors",
		setup: () => () => {},
		features: () => [
			{
				refKey: "monitor:1",
				ref: { kind: "monitor", id: "1" },
				name: "Arvin",
				value: 5,
				level: pm25Scale.levels[0],
				units: "µg/m³",
				lngLat: [-119.5, 36.5],
				selectable: true
			}
		]
	};
}

describe("focus ring", () => {
	it("draws a 2px ring outline and the ring-edge halo on a focused zoom button", async () => {
		root.setProperty("--ring", "rgb(0, 150, 255)");
		root.setProperty("--ring-edge", "rgb(0, 0, 128)");
		render(MapControls, { map: newMap(), gl });
		await userEvent.keyboard("{Tab}");
		const button = page.getByRole("button", { name: "Zoom in" }).element();
		expect(document.activeElement).toBe(button);
		const style = getComputedStyle(button);
		expect(style.outlineWidth).toBe("2px");
		expect(style.outlineStyle).toBe("solid");
		expect(style.outlineOffset).toBe("1px");
		expect(style.outlineColor).toBe("rgb(0, 150, 255)");
		expect(style.boxShadow).toBe("rgb(0, 0, 128) 0px 0px 0px 4px");
	});

	it("falls back to the background for the halo when --ring-edge is unset", async () => {
		root.setProperty("--ring", "rgb(0, 150, 255)");
		root.setProperty("--background", "rgb(10, 20, 30)");
		render(MapControls, { map: newMap(), gl });
		await userEvent.keyboard("{Tab}");
		const style = getComputedStyle(page.getByRole("button", { name: "Zoom in" }).element());
		expect(style.boxShadow).toBe("rgb(10, 20, 30) 0px 0px 0px 4px");
	});

	it("shows no ring on a button that is not focused", () => {
		render(MapControls, { map: newMap(), gl });
		const style = getComputedStyle(page.getByRole("button", { name: "Zoom in" }).element());
		expect(style.boxShadow).toBe("none");
	});

	it("draws the inset ring on the active list option while the listbox is focused", async () => {
		root.setProperty("--ring", "rgb(0, 150, 255)");
		root.setProperty("--ring-edge", "rgb(0, 0, 128)");
		const map = newMap();
		map.addPlugin(listPlugin());
		render(FeatureList, { map });
		await userEvent.keyboard("{Tab}{Tab}{Tab}");
		const box = page.getByRole("listbox").element() as HTMLElement;
		expect(document.activeElement).toBe(box);
		const row = document.querySelector<HTMLElement>("[role=option].active")!;
		const style = getComputedStyle(row);
		expect(style.outlineWidth).toBe("2px");
		expect(style.outlineOffset).toBe("-3px");
		expect(style.boxShadow).toBe("rgb(0, 0, 128) 0px 0px 0px 4px inset");
	});

	it("shows a visible name for a zoom button on focus", async () => {
		render(MapControls, { map: newMap(), gl });
		const tip = document.querySelector<HTMLElement>(".mapsdk-zoom-tip")!;
		expect(tip.textContent).toBe("Zoom in");
		expect(getComputedStyle(tip).opacity).toBe("0");
		await userEvent.keyboard("{Tab}");
		await expect.poll(() => getComputedStyle(tip).opacity).toBe("1");
	});

	it.each(["light", "dark"] as const)("has no axe violations in %s", async (theme) => {
		root.setProperty("--background", theme === "light" ? "#ffffff" : "#0b0f14");
		root.setProperty("--foreground", theme === "light" ? "#0b0f14" : "#f5f7fa");
		render(MapControls, { map: newMap(), gl });
		const result = await axe.run(document.querySelector(".mapsdk-zoom")!);
		expect(result.violations).toEqual([]);
	});
});

describe("motion", () => {
	it("uses the fast token duration, and none under reduced motion", async () => {
		render(MapControls, { map: newMap(), gl });
		const button = page.getByRole("button", { name: "Zoom in" }).element();
		expect(getComputedStyle(button).transitionDuration).toBe("0.12s");
		root.setProperty("--motion-duration-fast", "50ms");
		expect(getComputedStyle(button).transitionDuration).toBe("0.05s");
		root.removeProperty("--motion-duration-fast");
		await cdp().send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "reduce" }]
		});
		expect(getComputedStyle(button).transitionDuration).toBe("0s");
	});
});
