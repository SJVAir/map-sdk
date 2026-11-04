import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import axe from "axe-core";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { MapPlugin } from "../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../src/lib/data/format.js";
import { defaultMessages } from "../../src/lib/data/messages.js";
import Legend from "../../src/lib/ui/Legend.svelte";
import { pm25Scale, smokeScale } from "../fixtures/scales.js";

function fakeMap(plugins: Array<Pick<MapPlugin, "id" | "legend">>): MapContext {
	return { plugins, messages: defaultMessages, format: createDefaultFormat() } as never;
}

const map = fakeMap([
	{
		id: "points",
		legend: () => ({ pluginId: "points", title: "PM2.5", units: "µg/m³", scale: pm25Scale })
	},
	{
		id: "shapes",
		legend: () => ({ pluginId: "shapes", title: "Smoke", units: "", scale: smokeScale })
	},
	{ id: "loading", legend: () => ({ pluginId: "loading", status: { state: "loading" } }) }
]);

const THEMES = {
	light: { background: "oklch(1 0 0)", foreground: "oklch(0.145 0 0)" },
	dark: { background: "oklch(0.145 0 0)", foreground: "oklch(0.985 0 0)" }
};

afterEach(() => {
	document.documentElement.removeAttribute("style");
});

function applyTheme(name: keyof typeof THEMES) {
	const { background, foreground } = THEMES[name];
	document.documentElement.style.setProperty("--background", background);
	document.documentElement.style.setProperty("--foreground", foreground);
	document.documentElement.style.setProperty("--border", foreground);
	document.documentElement.style.setProperty("--muted-foreground", foreground);
}

/** Any CSS color to sRGB channels, through a canvas. */
function rgb(css: string): [number, number, number] {
	const ctx = document.createElement("canvas").getContext("2d")!;
	ctx.fillStyle = css;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return [r, g, b];
}

function luminance([r, g, b]: [number, number, number]): number {
	const lin = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe("Legend", () => {
	it("is a labelled region with a section per plugin that has a scale", async () => {
		applyTheme("light");
		render(Legend, { map });
		const region = page.getByRole("region", { name: "Legend" });
		await expect.element(region).toBeVisible();
		await expect.element(page.getByRole("heading", { name: "PM2.5 (µg/m³)" })).toBeVisible();
		await expect.element(page.getByRole("heading", { name: "Smoke" })).toBeVisible();
		expect(document.querySelectorAll(".mapsdk-legend-section")).toHaveLength(2);
	});

	it("shows every level's label next to its swatch", async () => {
		applyTheme("light");
		render(Legend, { map });
		const labels = [...pm25Scale.levels, ...smokeScale.levels].map((level) => level.label);
		for (const label of labels) {
			const text = page.getByText(label, { exact: true });
			await expect.element(text).toBeVisible();
			const item = text.element().closest("li")!;
			expect(item.querySelector(".mapsdk-legend-swatch")).not.toBeNull();
		}
		const ticks = [...document.querySelectorAll(".mapsdk-legend-ticks span")].map(
			(el) => el.textContent
		);
		expect(ticks).toEqual(["0", "9", "35", "55", "125", "225"]);
	});

	it("gives range levels' thresholds to screen readers", async () => {
		applyTheme("light");
		render(Legend, { map });
		const item = page.getByText("Moderate", { exact: true }).element().closest("li")!;
		expect(item.textContent).toContain("from 9");
		const smoke = page.getByText("Heavy", { exact: true }).element().closest("li")!;
		expect(smoke.textContent).not.toContain("from");
	});

	it("is hidden when no plugin has a legend", () => {
		render(Legend, { map: fakeMap([{ id: "x" }]) });
		expect(document.querySelector(".mapsdk-legend")!.hasAttribute("hidden")).toBe(true);
	});

	it.each(["light", "dark"] as const)(
		"outlines a yellow swatch at 3:1 against the background in %s",
		async (theme) => {
			applyTheme(theme);
			render(Legend, { map });
			const swatches = [...document.querySelectorAll<HTMLElement>(".mapsdk-legend-swatch")];
			const yellow = swatches.find(
				(el) => rgb(getComputedStyle(el).backgroundColor).join() === "255,255,0"
			)!;
			const style = getComputedStyle(yellow);
			const background = getComputedStyle(
				document.querySelector(".mapsdk-legend")!
			).backgroundColor;
			expect(style.outlineStyle).toBe("solid");
			expect(style.outlineWidth).toBe("1px");
			expect(contrast(style.outlineColor, background)).toBeGreaterThanOrEqual(3);
			// A gap keeps the outline off the swatch, so the swatch's own color never has to
			// reach 3:1 against it: in dark mode a light outline on yellow would fail.
			expect(parseFloat(style.outlineOffset)).toBeGreaterThanOrEqual(1);
			if (theme === "light") {
				expect(contrast(style.outlineColor, "#ffff00")).toBeGreaterThanOrEqual(3);
			}
		}
	);

	it("mixes a translucent block over the background token", async () => {
		applyTheme("dark");
		render(Legend, { map });
		const heavy = page.getByText("Heavy", { exact: true }).element().closest("li")!;
		const swatch = heavy.querySelector<HTMLElement>(".mapsdk-legend-swatch")!;
		// #333634 at 0.4 over near-black is darker than #333634 itself.
		const [r] = rgb(getComputedStyle(swatch).backgroundColor);
		expect(r).toBeLessThan(0x33);
	});

	it.each(["light", "dark"] as const)("has no axe violations in %s", async (theme) => {
		applyTheme(theme);
		render(Legend, { map });
		await expect.element(page.getByRole("region", { name: "Legend" })).toBeVisible();
		const result = await axe.run(document.querySelector(".mapsdk-legend")!);
		expect(result.violations).toEqual([]);
	});
});
