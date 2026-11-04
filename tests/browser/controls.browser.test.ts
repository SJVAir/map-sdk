import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import axe from "axe-core";
import { createMap, type MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { FeatureListItem, MapPlugin } from "../../src/lib/core/plugin.js";
import type { MetadataProvider } from "../../src/lib/data/metadata.js";
import MapControls from "../../src/lib/ui/MapControls.svelte";
import SelectionBarHost from "../fixtures/SelectionBarHost.svelte";
import SelectionBar from "../../src/lib/ui/SelectionBar.svelte";
import ViewSummary from "../../src/lib/ui/ViewSummary.svelte";
import { SUMMARY_DEBOUNCE_MS } from "../../src/lib/ui/view-summary.js";
import { pm25Scale } from "../fixtures/scales.js";

const [good, moderate] = pm25Scale.levels;

function item(id: string, level = good): FeatureListItem {
	return {
		refKey: `monitor:${id}`,
		ref: { kind: "monitor", id },
		name: `Monitor ${id}`,
		value: 5,
		level,
		units: "µg/m³",
		lngLat: [-119.5, 36.5],
		selectable: true
	};
}

function plugin(items: FeatureListItem[], extra: Partial<MapPlugin> = {}): MapPlugin {
	return {
		id: "monitors",
		label: "monitors",
		setup: () => () => {},
		features: () => items,
		legend: () => ({ pluginId: "monitors", title: "PM2.5", units: "µg/m³", scale: pm25Scale }),
		...extra
	};
}

function newMap(metadata?: Partial<MetadataProvider>): MapContext {
	return createMap({
		config: { maptilerKey: "k", basemaps: { styles: [], defaultId: "x" } },
		metadata: metadata as MetadataProvider
	});
}

/** Any CSS color to sRGBA channels (0–255), through a canvas. */
function rgba(css: string): [number, number, number, number] {
	const ctx = document.createElement("canvas").getContext("2d")!;
	ctx.fillStyle = css;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	return [r, g, b, a];
}

/** WCAG contrast ratio of two opaque colors. */
function contrast(a: string, b: string): number {
	const luminance = (css: string) => {
		const lin = rgba(css)
			.slice(0, 3)
			.map((c) => {
				const v = c / 255;
				return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
			});
		return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
	};
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("SelectionBar", () => {
	it("counts every selected id, including ones not in the data", async () => {
		const map = newMap();
		map.addPlugin(plugin([item("1")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1", "gone"] }
		});
		render(SelectionBar, { map });
		await expect.element(page.getByText("2 selected")).toBeVisible();
	});

	it("shows nothing without a selection", () => {
		const map = newMap();
		map.addPlugin(plugin([item("1")]), { selectionMode: "multiple" });
		render(SelectionBar, { map });
		expect(document.querySelector(".mapsdk-selection")).toBeNull();
	});

	it("clears through onselectionchange(null)", async () => {
		const map = newMap();
		const onselectionchange = vi.fn();
		map.addPlugin(plugin([item("1")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] },
			onselectionchange
		});
		render(SelectionBar, { map });
		await page.getByRole("button", { name: "Clear selection: monitors" }).click();
		expect(onselectionchange).toHaveBeenCalledExactlyOnceWith(null);
		expect(map.getSelection("monitors")).toBeNull();
		expect(document.querySelector(".mapsdk-selection")).toBeNull();
	});

	it("moves focus to the List button before the last Clear goes", async () => {
		const map = newMap();
		map.addPlugin(plugin([item("1")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] }
		});
		render(SelectionBarHost, { map });
		await page.getByRole("button", { name: "Clear selection: monitors" }).click();
		expect(document.querySelector(".mapsdk-selection")).toBeNull();
		expect(document.activeElement).toBe(document.querySelector(".mapsdk-list-button"));
	});

	it("moves focus to the map region when there is no List button", async () => {
		const map = newMap();
		map.addPlugin(plugin([item("1")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] }
		});
		render(SelectionBarHost, { map, list: false });
		await page.getByRole("button", { name: "Clear selection: monitors" }).click();
		expect(document.activeElement).toBe(document.querySelector("[data-mapsdk-map]"));
		expect(document.activeElement!.getAttribute("tabindex")).toBe("-1");
	});

	it("moves focus to the other plugin's Clear button while its selection remains", async () => {
		const map = newMap();
		map.addPlugin(plugin([item("1")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] }
		});
		map.addPlugin(plugin([item("9")], { id: "other", label: "other" }), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["9"] }
		});
		render(SelectionBarHost, { map });
		await page.getByRole("button", { name: "Clear selection: monitors" }).click();
		expect(map.getSelection("monitors")).toBeNull();
		expect(document.activeElement).toBe(
			page.getByRole("button", { name: "Clear selection: other" }).element()
		);
	});

	it("wraps within a 320px map, clear of the List and zoom buttons", async () => {
		const map = newMap();
		map.addPlugin(
			plugin([item("1")], { label: "a very long layer name that has to wrap somewhere" }),
			{ selectionMode: "multiple", selection: { kind: "monitors", ids: ["1", "2", "3"] } }
		);
		map.addPlugin(plugin([], { id: "b", label: "second" }), {
			selection: { kind: "monitors", ids: ["1"] }
		});
		render(SelectionBarHost, { map, width: 320 });
		const host = document.querySelector(".host")!.getBoundingClientRect();
		const bar = document.querySelector(".mapsdk-selection")!.getBoundingClientRect();
		expect(bar.left - host.left).toBeGreaterThanOrEqual(80);
		expect(host.right - bar.right).toBeGreaterThanOrEqual(64);
		for (const button of document.querySelectorAll(".mapsdk-selection button")) {
			const r = button.getBoundingClientRect();
			expect(r.right).toBeLessThanOrEqual(bar.right);
			expect(r.left).toBeGreaterThanOrEqual(bar.left);
		}
	});

	it("has no axe violations", async () => {
		const map = newMap();
		map.addPlugin(plugin([item("1")]), {
			selection: { kind: "monitors", ids: ["1"] }
		});
		render(SelectionBar, { map });
		await expect.element(page.getByText("1 selected")).toBeVisible();
		const result = await axe.run(document.querySelector(".mapsdk-selection")!);
		expect(result.violations).toEqual([]);
	});
});

describe("ViewSummary", () => {
	const bounds = { west: -120, south: 36, east: -119, north: 37 };
	const camera = { center: [-119.5, 36.5] as [number, number], zoom: 8, bearing: 0, pitch: 0 };
	const lines = (region: Element) => [...region.querySelectorAll("p")].map((p) => p.textContent);

	/** Records every DOM change under `region`, as the text a screen reader might be given. */
	function watch(region: Element) {
		const seen: string[] = [];
		const observer = new MutationObserver((records) => {
			for (const r of records) {
				for (const n of r.addedNodes) seen.push(n.textContent ?? "");
				if (r.type === "characterData") seen.push(r.target.textContent ?? "");
			}
		});
		observer.observe(region, { childList: true, subtree: true, characterData: true });
		return { seen, stop: () => observer.takeRecords().length >= 0 && observer.disconnect() };
	}

	async function settle(ms = SUMMARY_DEBOUNCE_MS) {
		await vi.advanceTimersByTimeAsync(ms);
		await Promise.resolve();
	}

	it("updates one polite live region 750 ms after the last move, with summary and selection", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		map.addPlugin(plugin([item("1"), item("2", moderate), item("3")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1", "gone"] }
		});
		render(ViewSummary, { map });
		const region = document.querySelector(".mapsdk-summary")!;
		expect(region.getAttribute("aria-live")).toBe("polite");
		expect(region.getAttribute("aria-atomic")).toBe("false");
		expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);

		map.updateView(camera, bounds);
		await settle(SUMMARY_DEBOUNCE_MS - 1);
		expect(lines(region)).toEqual(["monitors: 2 selected"]);
		// Another move restarts the wait.
		map.updateView(camera, bounds);
		await settle(SUMMARY_DEBOUNCE_MS - 1);
		expect(lines(region)).toEqual(["monitors: 2 selected"]);
		await settle(1);
		expect(lines(region)).toEqual(["monitors: 2 Good, 1 Moderate", "monitors: 2 selected"]);
	});

	it("leaves out features outside the view", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		map.addPlugin(plugin([item("1"), { ...item("2"), lngLat: [-100, 36.5] }]));
		render(ViewSummary, { map });
		map.updateView(camera, bounds);
		await settle();
		expect(lines(document.querySelector(".mapsdk-summary")!)).toEqual(["monitors: 1 Good"]);
	});

	it("doesn't announce the view and selection it starts with", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		map.updateView(camera, bounds);
		map.addPlugin(plugin([item("1")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] }
		});
		render(ViewSummary, { map });
		const region = document.querySelector(".mapsdk-summary")!;
		// Present when the region appears, and nothing is scheduled to say it again.
		expect(lines(region)).toEqual(["monitors: 1 Good", "monitors: 1 selected"]);
		expect(vi.getTimerCount()).toBe(0);
		const { seen, stop } = watch(region);
		await settle(2000);
		stop();
		expect(seen).toEqual([]);
	});

	it("announces only what changed: a pan leaves selection alone, a selection leaves the view alone", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		map.updateView(camera, bounds);
		map.addPlugin(plugin([item("1"), item("2")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] }
		});
		render(ViewSummary, { map });
		const region = document.querySelector(".mapsdk-summary")!;
		const { seen, stop } = watch(region);
		map.updateView(camera, bounds);
		await settle();
		expect(seen).toEqual([]);
		map.setSelection("monitors", { kind: "monitors", ids: ["1", "2"] });
		await settle();
		expect(seen).toEqual(["monitors: 2 selected"]);
		stop();
	});

	it("says once that a selection was cleared", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		map.updateView(camera, bounds);
		map.addPlugin(plugin([item("1")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] }
		});
		render(ViewSummary, { map });
		const region = document.querySelector(".mapsdk-summary")!;
		map.clearSelection("monitors");
		await settle();
		expect(lines(region)).toEqual(["monitors: 1 Good", "monitors: Selection cleared"]);
		map.updateView(camera, bounds);
		await settle();
		expect(lines(region)).toEqual(["monitors: 1 Good"]);
	});
});

describe("MapControls", () => {
	function fakeGl(): GlMapLike & { easeTo: ReturnType<typeof vi.fn> } {
		return { getZoom: () => 7, easeTo: vi.fn() } as never;
	}

	function reduceMotion(reduce: boolean) {
		vi.spyOn(globalThis, "matchMedia").mockImplementation(
			(query) =>
				({
					matches: reduce && query.includes("prefers-reduced-motion"),
					media: query,
					addEventListener() {},
					removeEventListener() {}
				}) as never
		);
	}

	it("has zoom buttons with accessible names that ease the camera", async () => {
		const gl = fakeGl();
		render(MapControls, { map: newMap(), gl });
		await page.getByRole("button", { name: "Zoom in" }).click();
		await page.getByRole("button", { name: "Zoom out" }).click();
		expect(gl.easeTo.mock.calls).toEqual([[{ zoom: 8 }], [{ zoom: 6 }]]);
	});

	it("moves without animation under prefers-reduced-motion", async () => {
		reduceMotion(true);
		const gl = fakeGl();
		render(MapControls, { map: newMap(), gl });
		await page.getByRole("button", { name: "Zoom in" }).click();
		expect(gl.easeTo).toHaveBeenCalledWith({ zoom: 8, duration: 0 });
	});

	it("shows each dataset's attribution once, with the MapTiler and OSM credits", async () => {
		const attribution = vi.fn(async (dataset: string) =>
			dataset === "missing" ? ("unavailable" as const) : "PurpleAir"
		);
		const map = newMap({ attribution });
		map.addPlugin(plugin([], { dataset: "air-quality" }));
		map.addPlugin(plugin([], { id: "b", dataset: "air-quality" }));
		map.addPlugin(plugin([], { id: "c", dataset: "missing" }));
		render(MapControls, { map, gl: null });
		await expect.element(page.getByText("PurpleAir")).toBeVisible();
		expect(document.querySelectorAll(".mapsdk-credits li")).toHaveLength(3);
		expect(attribution.mock.calls.map(([d]) => d).sort()).toEqual(["air-quality", "missing"]);
		const osm = page.getByRole("link", { name: "© OpenStreetMap contributors" });
		await expect.element(osm).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
		await expect
			.element(page.getByRole("link", { name: "© MapTiler" }))
			.toHaveAttribute("href", "https://www.maptiler.com/copyright/");
		const logo = page.getByRole("link", { name: "MapTiler logo, opens maptiler.com" });
		await expect.element(logo).toHaveAttribute("href", "https://www.maptiler.com/");
	});

	it("retries an unavailable attribution on a later move, at most once a minute", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		let ready = false;
		const attribution = vi.fn(async () => (ready ? "PurpleAir" : ("unavailable" as const)));
		const map = newMap({ attribution });
		map.addPlugin(plugin([], { dataset: "air-quality" }));
		render(MapControls, { map, gl: null });
		await vi.advanceTimersByTimeAsync(0);
		expect(attribution).toHaveBeenCalledTimes(1);
		const view = { west: -120, south: 36, east: -119, north: 37 };
		const camera = { center: [-119.5, 36.5] as [number, number], zoom: 8, bearing: 0, pitch: 0 };
		ready = true;
		map.updateView(camera, view);
		await vi.advanceTimersByTimeAsync(30_000);
		map.updateView(camera, view);
		await vi.advanceTimersByTimeAsync(0);
		expect(attribution).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(30_000);
		map.updateView(camera, view);
		await vi.advanceTimersByTimeAsync(0);
		expect(attribution).toHaveBeenCalledTimes(2);
		await expect.element(page.getByText("PurpleAir")).toBeVisible();
	});

	/** The design pass's light and dark values, as in the demo's app.css. */
	const THEMES = {
		light: {
			"--card": "oklch(1 0 0)",
			"--card-foreground": "oklch(0.257 0.061 257.8)",
			"--link": "oklch(0.527 0.124 247.4)",
			"--overlay": "oklch(0.257 0.061 257.8 / 10%)"
		},
		dark: {
			"--card": "oklch(0.252 0.05 259.4)",
			"--card-foreground": "oklch(0.946 0.015 251.2)",
			"--link": "oklch(0.791 0.101 239.5)",
			"--overlay": "oklch(0 0 0 / 40%)"
		}
	};

	it.each(["light", "dark"] as const)(
		"puts the credits on an opaque card with 4.5:1 text and links in %s",
		async (theme) => {
			const root = document.documentElement.style;
			for (const [token, value] of Object.entries(THEMES[theme])) root.setProperty(token, value);
			try {
				const map = newMap({ attribution: async () => "PurpleAir" });
				map.addPlugin(plugin([], { dataset: "air-quality" }));
				render(MapControls, { map, gl: null });
				await expect.element(page.getByText("PurpleAir")).toBeVisible();
				const credits = getComputedStyle(document.querySelector(".mapsdk-credits")!);
				const background = rgba(credits.backgroundColor);
				expect(background[3]).toBe(255);
				expect(background).toEqual(rgba(THEMES[theme]["--card"]));
				const text = getComputedStyle(page.getByText("PurpleAir").element()).color;
				const link = getComputedStyle(page.getByRole("link", { name: "© MapTiler" }).element());
				expect(contrast(text, credits.backgroundColor)).toBeGreaterThanOrEqual(4.5);
				expect(contrast(link.color, credits.backgroundColor)).toBeGreaterThanOrEqual(4.5);
			} finally {
				for (const token of Object.keys(THEMES[theme])) root.removeProperty(token);
			}
		}
	);

	it("gives the logo a size before it loads", () => {
		render(MapControls, { map: newMap(), gl: null });
		const img = document.querySelector<HTMLImageElement>(".mapsdk-logo img")!;
		expect(img.getAttribute("width")).toBe("80");
		expect(img.getAttribute("height")).toBe("24");
	});

	it("has no axe violations", async () => {
		const map = newMap({ attribution: async () => "PurpleAir" });
		map.addPlugin(plugin([], { dataset: "air-quality" }));
		render(MapControls, { map, gl: fakeGl() });
		await expect.element(page.getByText("PurpleAir")).toBeVisible();
		for (const selector of [".mapsdk-zoom", ".mapsdk-credits"]) {
			const result = await axe.run(document.querySelector(selector)!);
			expect(result.violations).toEqual([]);
		}
	});
});
