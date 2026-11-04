import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import axe from "axe-core";
import { createMap, type MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { FeatureListItem, MapPlugin } from "../../src/lib/core/plugin.js";
import type { MetadataProvider } from "../../src/lib/data/metadata.js";
import MapControls from "../../src/lib/ui/MapControls.svelte";
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

	it("updates one live region 750 ms after the last move, with summary and selection", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		map.addPlugin(plugin([item("1"), item("2", moderate), item("3")]), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1", "gone"] }
		});
		render(ViewSummary, { map });
		const region = document.querySelector(".mapsdk-summary")!;
		expect(region.getAttribute("aria-live")).toBe("polite");
		expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);

		map.updateView(camera, bounds);
		await vi.advanceTimersByTimeAsync(SUMMARY_DEBOUNCE_MS - 1);
		expect(region.textContent).toBe("");
		// Another move restarts the wait.
		map.updateView(camera, bounds);
		await vi.advanceTimersByTimeAsync(SUMMARY_DEBOUNCE_MS - 1);
		expect(region.textContent).toBe("");
		await vi.advanceTimersByTimeAsync(1);
		expect([...region.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
			"monitors: 2 Good, 1 Moderate",
			"monitors: 2 selected"
		]);
	});

	it("leaves out features outside the view", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		map.addPlugin(plugin([item("1"), { ...item("2"), lngLat: [-100, 36.5] }]));
		render(ViewSummary, { map });
		map.updateView(camera, bounds);
		await vi.advanceTimersByTimeAsync(SUMMARY_DEBOUNCE_MS);
		expect(document.querySelector(".mapsdk-summary")!.textContent).toBe("monitors: 1 Good");
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
