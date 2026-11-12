import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import axe from "axe-core";
import { createMap, type MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { FeatureListItem, MapPlugin } from "../../src/lib/core/plugin.js";
import type { MetadataProvider } from "../../src/lib/data/metadata.js";
import MapControls from "../../src/lib/ui/MapControls.svelte";
import DataCreditsHost from "../fixtures/DataCreditsHost.svelte";
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

	it("says nothing for a summarizeEmpty: false plugin with nothing in view", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		const place = { ...item("p"), name: "Home", lngLat: [-100, 36.5] as [number, number] };
		map.addPlugin(
			plugin([place], { id: "focus", label: "Places", legend: undefined, summarizeEmpty: false })
		);
		map.addPlugin(plugin([item("1")]));
		render(ViewSummary, { map });
		const region = document.querySelector(".mapsdk-summary")!;
		map.updateView(camera, bounds);
		await settle();
		expect(lines(region)).toEqual(["monitors: 1 Good"]);
	});

	it("still summarizes a summarizeEmpty: false plugin with something in view", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const map = newMap();
		map.addPlugin(
			plugin([item("p")], {
				id: "focus",
				label: "Places",
				legend: undefined,
				summarizeEmpty: false
			})
		);
		render(ViewSummary, { map });
		const region = document.querySelector(".mapsdk-summary")!;
		map.updateView(camera, bounds);
		await settle();
		expect(lines(region)).toHaveLength(1);
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

	it("retries an unavailable attribution on a later move, at most once a minute", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
		let ready = false;
		const attribution = vi.fn(async () => (ready ? "PurpleAir" : ("unavailable" as const)));
		const map = newMap({ attribution });
		map.addPlugin(plugin([], { dataset: "air-quality" }));
		render(DataCreditsHost, { map });
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

	it("has no axe violations", async () => {
		render(MapControls, { map: newMap(), gl: fakeGl() });
		const result = await axe.run(document.querySelector(".mapsdk-zoom")!);
		expect(result.violations).toEqual([]);
	});
});
