import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import axe from "axe-core";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { MapPlugin } from "../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../src/lib/data/format.js";
import { defaultMessages } from "../../src/lib/data/messages.js";
import Legend from "../../src/lib/ui/Legend.svelte";
import { pm25Scale, smokeScale } from "../fixtures/scales.js";

function fakeMap(plugins: Array<Pick<MapPlugin, "id" | "legend" | "label">>): MapContext {
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
	{
		id: "loading",
		label: "Wildfires",
		legend: () => ({ pluginId: "loading", status: { state: "loading" } })
	}
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
		for (const { label } of pm25Scale.levels) {
			const text = page.getByText(label, { exact: true });
			await expect.element(text).toBeVisible();
			expect(text.element().closest("li")!.querySelector(".mapsdk-legend-swatch")).not.toBeNull();
		}
		// A blocks legend is one bar with the labels under it, not chips.
		for (const { label } of smokeScale.levels) {
			await expect.element(page.getByText(label, { exact: true })).toBeVisible();
		}
		const ticks = [...document.querySelectorAll(".mapsdk-legend-ticks span")].map(
			(el) => el.textContent
		);
		expect(ticks).toEqual(["0", "9", "35", "55", "125", "225"]);
	});

	it("gives a range scale's blocks the visually hidden threshold text, none for categories", async () => {
		const blocks = fakeMap([
			{
				id: "points",
				legend: () => ({
					pluginId: "points",
					title: "PM2.5",
					units: "µg/m³",
					scale: pm25Scale,
					display: "blocks"
				})
			}
		]);
		render(Legend, { map: blocks });
		const items = [...document.querySelectorAll(".mapsdk-legend-block-labels li")];
		expect(items[0].textContent!.replace(/\s+/g, " ").trim()).toBe("Good from 0");
		expect(items[1].textContent!.replace(/\s+/g, " ").trim()).toBe("Moderate from 9");
		const hidden = items[1].querySelector<HTMLElement>(".mapsdk-legend-threshold")!;
		expect(hidden.getBoundingClientRect().width).toBeLessThanOrEqual(1);
	});

	it("leaves the threshold text out of a category scale's blocks", async () => {
		render(Legend, { map });
		const smoke = document.querySelectorAll(".mapsdk-legend-section")[1];
		expect(smoke.querySelector(".mapsdk-legend-threshold")).toBeNull();
	});

	it("draws blocks as one outlined bar with each label under its segment", async () => {
		applyTheme("light");
		render(Legend, { map });
		const bar = document.querySelector<HTMLElement>(".mapsdk-legend-blocks")!;
		const segments = [...bar.querySelectorAll<HTMLElement>(".mapsdk-legend-block")];
		expect(segments).toHaveLength(smokeScale.levels.length);
		// Contiguous: segments touch edge to edge, inside one outlined bar.
		const rects = segments.map((el) => el.getBoundingClientRect());
		for (let i = 1; i < rects.length; i++) {
			expect(rects[i].left).toBeCloseTo(rects[i - 1].right, 1);
		}
		expect(getComputedStyle(bar).outlineStyle).toBe("solid");
		expect(
			document
				.querySelectorAll(".mapsdk-legend-section")[1]
				.querySelector("li > .mapsdk-legend-swatch")
		).toBeNull();
		// Each label is centered under its own segment.
		const labels = [...document.querySelectorAll<HTMLElement>(".mapsdk-legend-block-labels li")];
		labels.forEach((li, i) => {
			const box = li.getBoundingClientRect();
			expect(box.left).toBeCloseTo(rects[i].left, 0);
			expect(box.top).toBeGreaterThanOrEqual(rects[i].bottom);
		});
	});

	it("wraps a long block label inside its segment's column", async () => {
		applyTheme("light");
		const long = {
			...smokeScale,
			levels: smokeScale.levels.map((level, i) =>
				i === 0 ? { ...level, label: "Unhealthy for Sensitive Groups" } : level
			)
		};
		render(Legend, {
			map: fakeMap([
				{ id: "s", legend: () => ({ pluginId: "s", title: "Smoke", units: "", scale: long }) }
			])
		});
		const li = document.querySelector<HTMLElement>(".mapsdk-legend-block-labels li")!;
		const block = document.querySelector<HTMLElement>(".mapsdk-legend-block")!;
		expect(li.scrollWidth).toBeLessThanOrEqual(li.clientWidth);
		expect(li.getBoundingClientRect().width).toBeCloseTo(block.getBoundingClientRect().width, 0);
		expect(li.getBoundingClientRect().height).toBeGreaterThan(20);
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
		const swatch = document.querySelectorAll<HTMLElement>(".mapsdk-legend-block")[2];
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

	it("shows a loading line under the layer's name while a plugin loads", async () => {
		applyTheme("light");
		render(Legend, { map });
		const status = page.getByRole("status").filter({ hasText: "Wildfires" });
		await expect.element(status).toBeVisible();
		await expect.element(status.getByText("Loading", { exact: true })).toBeVisible();
	});

	it("says a layer isn't available right now", async () => {
		applyTheme("light");
		render(Legend, {
			map: fakeMap([
				{
					id: "smoke",
					label: "Smoke",
					legend: () => ({
						pluginId: "smoke",
						status: { state: "unavailable", reason: "scale" }
					})
				}
			])
		});
		await expect.element(page.getByText("Smoke isn't available right now")).toBeVisible();
		expect(page.getByRole("button").elements()).toHaveLength(0);
		expect(document.querySelector(".mapsdk-legend")!.hasAttribute("hidden")).toBe(false);
	});

	it("offers Try again on an error, which calls the status's retry", async () => {
		applyTheme("light");
		document.documentElement.style.setProperty("--ring", "rgb(0, 150, 255)");
		document.documentElement.style.setProperty("--ring-edge", "rgb(0, 0, 128)");
		const retry = vi.fn();
		render(Legend, {
			map: fakeMap([
				{
					id: "fires",
					label: "Fires",
					legend: () => ({
						pluginId: "fires",
						status: { state: "error", error: new Error("down"), retry }
					})
				}
			])
		});
		await expect.element(page.getByText("Fires isn't available right now")).toBeVisible();
		const button = page.getByRole("button", { name: "Try again" });
		await userEvent.keyboard("{Tab}");
		expect(document.activeElement).toBe(button.element());
		const style = getComputedStyle(button.element());
		expect(style.outlineWidth).toBe("2px");
		expect(style.outlineColor).toBe("rgb(0, 150, 255)");
		expect(style.boxShadow).toBe("rgb(0, 0, 128) 0px 0px 0px 4px");
		await button.click();
		expect(retry).toHaveBeenCalledTimes(1);
		const result = await axe.run(document.querySelector(".mapsdk-legend")!);
		expect(result.violations).toEqual([]);
	});

	it("shows nothing for a ready status", () => {
		render(Legend, {
			map: fakeMap([{ id: "x", legend: () => ({ pluginId: "x", status: { state: "ready" } }) }])
		});
		expect(document.querySelector(".mapsdk-legend")!.hasAttribute("hidden")).toBe(true);
	});

	it("top-first lists the top plugin first", async () => {
		applyTheme("light");
		const titled = (id: string, title: string, scale = pm25Scale): never =>
			({ id, legend: () => ({ pluginId: id, title, units: "", scale }) }) as never;
		const three = fakeMap([titled("a", "Bottom"), titled("b", "Middle"), titled("c", "Top")]);
		const headings = () =>
			[...document.querySelectorAll(".mapsdk-legend-section h3")].map((h) => h.textContent?.trim());
		const { unmount } = await render(Legend, { map: three, order: "top-first" });
		await expect.element(page.getByRole("heading", { name: "Top" })).toBeVisible();
		expect(headings()).toEqual(["Top", "Middle", "Bottom"]);
		unmount();
		render(Legend, { map: three });
		await expect.element(page.getByRole("heading", { name: "Top" })).toBeVisible();
		expect(headings()).toEqual(["Bottom", "Middle", "Top"]);
	});
});

describe("Legend framed={false}", () => {
	/** A host card around the legend, 300px wide. */
	function card(background: string): HTMLElement {
		const wrapper = document.createElement("div");
		wrapper.style.width = "300px";
		wrapper.style.background = background;
		document.body.append(wrapper);
		return wrapper;
	}
	const legend = () => document.querySelector<HTMLElement>(".mapsdk-legend")!;
	const block = () => document.querySelectorAll<HTMLElement>(".mapsdk-legend-block")[2];
	const red = () => rgb(getComputedStyle(block()).backgroundColor)[0];

	afterEach(() => {
		document.body.replaceChildren();
	});

	it("draws no frame and fills its container", async () => {
		applyTheme("light");
		render(Legend, { target: card("transparent"), props: { map, framed: false } });
		await expect.element(page.getByRole("region", { name: "Legend" })).toBeVisible();
		const style = getComputedStyle(legend());
		expect(style.borderTopWidth).toBe("0px");
		expect(style.paddingTop).toBe("0px");
		expect(style.boxShadow).toBe("none");
		expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
		expect(legend().getBoundingClientRect().width).toBe(300);
		await expect.element(page.getByRole("heading", { name: "PM2.5 (µg/m³)" })).toBeVisible();
	});

	it("blends translucent blocks over the host's card", async () => {
		applyTheme("dark");
		render(Legend, { target: card("rgb(255, 255, 255)"), props: { map, framed: false } });
		await vi.waitFor(() => expect(red()).toBeGreaterThan(0x33));
	});

	it("falls back to the background token with no opaque card", async () => {
		applyTheme("dark");
		const framed = await render(Legend, { map });
		await vi.waitFor(() => expect(red()).toBeLessThan(0x33));
		const expected = getComputedStyle(block()).backgroundColor;
		framed.unmount();
		render(Legend, { target: card("transparent"), props: { map, framed: false } });
		await vi.waitFor(() => expect(getComputedStyle(block()).backgroundColor).toBe(expected));
	});

	it("re-reads the card's color on a theme change", async () => {
		// The card's color is the opposite of the page's, so only reading the card passes.
		applyTheme("light");
		document.documentElement.style.setProperty("--card", "rgb(0, 0, 0)");
		render(Legend, { target: card("var(--card)"), props: { map, framed: false } });
		await vi.waitFor(() => expect(red()).toBeLessThan(0x33));
		applyTheme("dark");
		document.documentElement.style.setProperty("--card", "rgb(255, 255, 255)");
		await vi.waitFor(() => expect(red()).toBeGreaterThan(0x33));
	});

	it("follows framed after mount", async () => {
		applyTheme("light");
		const view = await render(Legend, { map });
		await expect.element(page.getByRole("region", { name: "Legend" })).toBeVisible();
		expect(getComputedStyle(legend()).borderTopWidth).toBe("1px");
		await view.rerender({ framed: false });
		expect(getComputedStyle(legend()).borderTopWidth).toBe("0px");
		await view.rerender({ framed: true });
		expect(getComputedStyle(legend()).borderTopWidth).toBe("1px");
	});

	it("keeps today's card by default", async () => {
		applyTheme("light");
		render(Legend, { map });
		await expect.element(page.getByRole("region", { name: "Legend" })).toBeVisible();
		expect(getComputedStyle(legend()).width).toBe("336px");
		expect(getComputedStyle(legend()).borderTopWidth).toBe("1px");
	});
});
