import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { cdp, page, userEvent } from "vitest/browser";
import axe from "axe-core";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import { MapView } from "../../src/lib/index.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { MapPlugin } from "../../src/lib/core/plugin.js";
import FeatureList from "../../src/lib/ui/FeatureList.svelte";
import MapControls from "../../src/lib/ui/MapControls.svelte";
import { pm25Scale } from "../fixtures/scales.js";

const root = document.documentElement.style;
const TOKENS = [
	"--background",
	"--foreground",
	"--ring",
	"--ring-edge",
	"--border",
	"--accent",
	"--highlight",
	"--shadow-card"
];

const basemaps = {
	styles: [{ id: "a", style: { version: 8 as const, sources: {}, layers: [] } }],
	defaultId: "a"
};

/** Any CSS color to sRGB channels, through a canvas. */
function rgb(css: string): [number, number, number] {
	const ctx = document.createElement("canvas").getContext("2d")!;
	ctx.fillStyle = css;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return [r, g, b];
}

function luminance([r, g, b]: [number, number, number]): number {
	const lin = [r, g, b].map((c) => {
		const v = c / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

afterEach(async () => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
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

describe("List button", () => {
	async function renderView() {
		root.setProperty("--ring", "rgb(0, 150, 255)");
		root.setProperty("--ring-edge", "rgb(0, 0, 128)");
		const map = createMap({ config: { maptilerKey: "k", basemaps } });
		const attached: GlMapLike[] = [];
		const attach = map.attach.bind(map);
		vi.spyOn(map, "attach").mockImplementation((gl) => {
			attached.push(gl);
			attach(gl);
		});
		render(MapView, { map, class: "test-map" });
		// Unmounting before the style loads makes MapTiler's SDK throw.
		return new Promise<void>((resolve) => {
			const gl = attached[0] as unknown as { loaded(): boolean; on: GlMapLike["on"] };
			if (gl.loaded()) resolve();
			else gl.on("load", () => resolve());
		});
	}

	const focusListButton = async () => {
		await userEvent.keyboard("{Tab}");
		const button = document.querySelector<HTMLElement>(".mapsdk-list-button")!;
		button.focus();
		return button;
	};

	it.each([
		["unset", null],
		["none", "none"],
		["a shadow", "0 1px 2px rgb(0, 0, 0)"]
	])("shows the outline and halo with --shadow-card %s", async (_name, value) => {
		if (value) root.setProperty("--shadow-card", value);
		await renderView();
		const button = await focusListButton();
		expect(document.activeElement).toBe(button);
		const style = getComputedStyle(button);
		expect(style.outlineWidth).toBe("2px");
		expect(style.boxShadow).toBe("rgb(0, 0, 128) 0px 0px 0px 4px");
	});

	it("shows only an outline, no halo, on the script-focused map region", async () => {
		await renderView();
		await userEvent.keyboard("{Tab}");
		const region = document.querySelector<HTMLElement>("[role=region][data-mapsdk-map]")!;
		region.setAttribute("tabindex", "-1");
		region.focus();
		expect(document.activeElement).toBe(region);
		const style = getComputedStyle(region);
		expect(style.outlineWidth).toBe("2px");
		expect(style.outlineColor).toBe("rgb(0, 150, 255)");
		expect(style.boxShadow).toBe("none");
	});
});

describe("selected and active list option", () => {
	it("shows both the focus ring and the selection ring", async () => {
		root.setProperty("--ring-edge", "rgb(0, 0, 128)");
		root.setProperty("--highlight", "rgb(200, 0, 100)");
		const map = newMap();
		map.addPlugin(listPlugin(), { selectionMode: "multiple" });
		render(FeatureList, { map });
		await userEvent.keyboard("{Tab}{Tab}{Tab}{Enter}");
		const row = document.querySelector<HTMLElement>("[role=option].active.selected")!;
		expect(row).not.toBeNull();
		const shadow = getComputedStyle(row).boxShadow;
		expect(shadow).toContain("rgb(0, 0, 128)");
		expect(shadow).toContain("rgb(200, 0, 100)");
		root.removeProperty("--highlight");
	});
});

describe("hover fill", () => {
	it.each([
		["light", "#ffffff", "#0b0f14", "#e8edf2"],
		["dark", "#0b0f14", "#f5f7fa", "#222b36"]
	])("keeps --foreground text at 4.5:1 on --accent in %s", async (_n, bg, fg, accent) => {
		root.setProperty("--background", bg);
		root.setProperty("--foreground", fg);
		root.setProperty("--accent", accent);
		render(MapControls, { map: newMap(), gl });
		const button = page.getByRole("button", { name: "Zoom in" });
		await button.hover();
		const style = getComputedStyle(button.element());
		// The fill fades in (the fast motion token); wait for it to settle.
		await expect.poll(() => rgb(style.backgroundColor)).toEqual(rgb(accent));
		expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
	});
});
