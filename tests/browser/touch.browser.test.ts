import { createRawSnippet } from "svelte";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { cdp, page, userEvent } from "vitest/browser";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap, pointsPlugin } from "../../src/lib/index.js";
import type { FeatureClickHandler } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { FeatureListItem } from "../../src/lib/core/plugin.js";
import { staticSource } from "../../src/lib/data/static-source.js";
import type { MapFeatureProperties } from "../../src/lib/data/types.js";
import FeatureList from "../../src/lib/ui/FeatureList.svelte";
import { rootEffect } from "../fixtures/effects.svelte.js";
import { pm25Scale } from "../fixtures/scales.js";
import { parkPointer } from "./park-pointer.js";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

type ClickEvent = Parameters<FeatureClickHandler>[0];
const style = { version: 8, sources: {}, layers: [] };
const SITE: [number, number] = [-119.8, 36.7];
const EXPECTED_WARNINGS = [
	/^MapTiler Cloud API key is not set/,
	/^\[webglcontextlost\] .* harmless/
];
const warn = console.warn.bind(console);
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	if (!EXPECTED_WARNINGS.some((re) => re.test(args.map(String).join(" ")))) warn(...args);
});
const sized = document.createElement("style");
sized.textContent = ".touch-map { width: 600px; height: 400px; }";

beforeAll(() => {
	maptilerConfig.telemetry = false;
	document.head.append(sized);
	vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("offline")));
});
const stops: Array<() => void> = [];
afterEach(async () => {
	for (const stop of stops.splice(0)) stop();
	await parkPointer();
	document.body.replaceChildren();
});
afterAll(() => sized.remove());

/** A real touch tap at a point of this frame's viewport. */
async function tap(x: number, y: number) {
	const frame = (window.frameElement as HTMLElement | null)?.getBoundingClientRect();
	const at = { x: (frame?.left ?? 0) + x, y: (frame?.top ?? 0) + y };
	const send = cdp().send.bind(cdp()) as (m: string, p: unknown) => Promise<unknown>;
	await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
	await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A second site close enough to `SITE` to cluster with it at zoom 10. */
const NEAR: [number, number] = [SITE[0] + 0.002, SITE[1]];
const clusterTip = createRawSnippet(() => ({ render: () => "<span>Two sites</span>" }));

/**
 * A MapView with one monitor at `SITE` (or, `clustered`, a bubble of it and one at `NEAR`), the
 * featureclick events it reports, and every touch hover it sets.
 */
async function siteMap(tooltipOnTouch?: boolean, clustered = false) {
	const map = createMap({
		config: {
			maptilerKey: "test-key",
			basemaps: { styles: [{ id: "a", style }], defaultId: "a" },
			initialView: { center: SITE, zoom: 10, bearing: 0, pitch: 0 }
		}
	});
	map.addPlugin(
		pointsPlugin<MapFeatureProperties>({
			id: "monitors",
			layerLabel: "Monitors",
			circle: { radius: 12 },
			tooltipOnTouch,
			cluster: clustered ? { radius: 60, maxZoom: 14, tooltip: () => clusterTip } : undefined,
			source: staticSource(
				{
					type: "FeatureCollection",
					features: [
						{
							type: "Feature",
							geometry: { type: "Point", coordinates: SITE },
							properties: { refKey: "feature:s1", name: "Site", value: 10 }
						},
						...(clustered
							? [
									{
										type: "Feature" as const,
										geometry: { type: "Point" as const, coordinates: NEAR },
										properties: { refKey: "feature:s2", name: "Near", value: 12 }
									}
								]
							: [])
					]
				},
				pm25Scale
			)
		})
	);
	const events: ClickEvent[] = [];
	map.on("featureclick", (e) => events.push(e));
	const attached: GlMapLike[] = [];
	const attach = map.attach.bind(map);
	vi.spyOn(map, "attach").mockImplementation((gl) => {
		attached.push(gl);
		attach(gl);
	});
	render(MapView, { map, class: "touch-map", label: "Touch map" });
	await vi.waitFor(() => expect(map.ready).toBe(true), { timeout: 5000 });
	const gl = attached[0];
	const canvas = gl.getCanvas();
	// Drawn: a point's hit, or a bubble (which `featuresAt` leaves out).
	await vi.waitFor(() => {
		const { x, y } = gl.project(SITE);
		expect(gl.queryRenderedFeatures([x, y]).length).toBeGreaterThan(0);
	});
	// Desktop Chrome moves its real mouse back after a tap, so a touch hover may last only a moment.
	const touchHovers: string[] = [];
	stops.push(
		rootEffect(() => {
			const h = map.hovered;
			if (h?.touch) touchHovers.push(h.hit.refKey);
		})
	);
	return { map, gl, canvas, events, touchHovers };
}

describe("tooltipOnTouch", () => {
	/**
	 * Whether a hover tooltip showed at any point during `act`. Desktop Chrome moves its real mouse
	 * back after a tap (a phone has none), which ends the hover, so a check after the tap is too late.
	 */
	async function tooltipShownDuring(act: () => Promise<void>): Promise<boolean> {
		let shown = document.querySelector("[role=tooltip]") !== null;
		const observer = new MutationObserver(() => {
			if (document.querySelector("[role=tooltip]")) shown = true;
		});
		observer.observe(document.body, { childList: true, subtree: true });
		try {
			await act();
			await new Promise((r) => setTimeout(r, 300));
		} finally {
			observer.disconnect();
		}
		return shown;
	}

	it("false: a tapped feature leaves no hover tooltip, while a mouse hover still shows one", async () => {
		const { gl, canvas, touchHovers } = await siteMap(false);
		const { x, y } = gl.project(SITE);
		const box = canvas.getBoundingClientRect();
		expect(await tooltipShownDuring(() => tap(box.left + x, box.top + y))).toBe(false);
		// The tap did hover the feature: the tooltip was left out, not never asked for.
		expect(touchHovers).toContain("feature:s1");

		// A few pixels off the tap: a mouse move right at its point just after is the tap's own.
		await page.elementLocator(canvas).hover({ position: { x: x + 7, y } });
		await expect.element(page.getByRole("tooltip")).toBeVisible();
	});

	it("false: a tapped cluster bubble leaves no hover tooltip, while a mouse hover shows it", async () => {
		const { map, gl, canvas, touchHovers } = await siteMap(false, true);
		const mid: [number, number] = [(SITE[0] + NEAR[0]) / 2, SITE[1]];
		const { x, y } = gl.project(mid);
		await page.elementLocator(canvas).hover({ position: { x, y } });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Two sites");
		await parkPointer();
		await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
		expect(map.hovered).toBeNull();

		const box = canvas.getBoundingClientRect();
		expect(await tooltipShownDuring(() => tap(box.left + x, box.top + y))).toBe(false);
		expect(touchHovers.length).toBeGreaterThan(0);
	});

	it("unset: a tapped feature shows its hover tooltip, as before", async () => {
		const { gl, canvas } = await siteMap();
		const { x, y } = gl.project(SITE);
		const box = canvas.getBoundingClientRect();
		expect(await tooltipShownDuring(() => tap(box.left + x, box.top + y))).toBe(true);
	});
});

describe("featureclick's touch", () => {
	it("is false for a mouse click on a map feature and true for a touch tap", async () => {
		const { gl, canvas, events } = await siteMap();
		const { x, y } = gl.project(SITE);
		await page.elementLocator(canvas).click({ position: { x, y } });
		await vi.waitFor(() => expect(events).toHaveLength(1));
		expect(events[0]).toMatchObject({ pluginId: "monitors", touch: false });

		const box = canvas.getBoundingClientRect();
		await tap(box.left + x, box.top + y);
		await vi.waitFor(() => expect(events).toHaveLength(2));
		expect(events[1]).toMatchObject({ pluginId: "monitors", touch: true });
	});

	it("reads a press on a marker over a feature, after a touch pan left touch behind", async () => {
		const { gl, canvas, events } = await siteMap();
		const { x, y } = gl.project(SITE);
		// A host's Marker: a DOM element in the canvas's container, over the feature.
		const marker = document.createElement("div");
		marker.style.cssText = `position: absolute; left: ${x - 6}px; top: ${y - 6}px; width: 12px; height: 12px`;
		canvas.parentElement!.append(marker);
		// A touch pan on the canvas: a press with no click and no pointercancel.
		const box = canvas.getBoundingClientRect();
		const send = cdp().send.bind(cdp()) as (m: string, p: unknown) => Promise<unknown>;
		const frame = (window.frameElement as HTMLElement | null)?.getBoundingClientRect();
		const at = (px: number, py: number) => ({
			x: (frame?.left ?? 0) + box.left + px,
			y: (frame?.top ?? 0) + box.top + py
		});
		await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(100, 100)] });
		for (const step of [20, 40, 60, 80]) {
			await send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [at(100 + step, 100)]
			});
		}
		await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		await new Promise((r) => setTimeout(r, 100));
		expect(events).toHaveLength(0);
		const moved = gl.project(SITE);
		marker.style.left = `${moved.x - 6}px`;
		marker.style.top = `${moved.y - 6}px`;

		await page.elementLocator(marker).click();
		await vi.waitFor(() => expect(events).toHaveLength(1));
		expect(events[0]).toMatchObject({ pluginId: "monitors", touch: false });
	});

	/** A FeatureList with one row, and each featureclick's `touch`. */
	async function oneRowList() {
		const map = createMap({ config: { maptilerKey: "test-key" } });
		const item: FeatureListItem = {
			refKey: "monitor:1",
			ref: { kind: "monitor", id: "1" },
			name: "Arvin",
			value: 5,
			level: pm25Scale.levels[0],
			units: "µg/m³",
			lngLat: [-119.5, 36.5],
			selectable: true
		};
		map.addPlugin({ id: "monitors", setup: () => () => {}, features: () => [item] });
		const seen: boolean[] = [];
		map.on("featureclick", (e) => seen.push(e.touch));
		render(FeatureList, { map });
		const row = page.getByRole("option", { name: /Arvin/ });
		await expect.element(row).toBeVisible();
		return { row, seen };
	}

	it("is true for a tapped list row, false for a clicked one or Enter", async () => {
		const { row, seen } = await oneRowList();
		const r = row.element().getBoundingClientRect();
		await tap(r.left + r.width / 2, r.top + r.height / 2);
		await vi.waitFor(() => expect(seen).toEqual([true]));

		await row.click();
		await vi.waitFor(() => expect(seen).toEqual([true, false]));

		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() => expect(seen).toEqual([true, false, false]));
	});

	it("adds tapped list rows to a multiple selection; a mouse click still replaces", async () => {
		const map = createMap({ config: { maptilerKey: "test-key" } });
		const row = (id: string, name: string): FeatureListItem => ({
			refKey: `monitor:${id}`,
			ref: { kind: "monitor", id },
			name,
			value: 5,
			level: pm25Scale.levels[0],
			units: "µg/m³",
			lngLat: [-119.5, 36.5],
			selectable: true
		});
		const items = [row("1", "Arvin"), row("2", "Bakersfield"), row("3", "Clovis")];
		map.addPlugin(
			{ id: "monitors", setup: () => () => {}, features: () => items },
			{ selectionMode: "multiple" }
		);
		render(FeatureList, { map });
		const tapRow = async (name: string) => {
			const option = page.getByRole("option", { name: new RegExp(name) });
			await expect.element(option).toBeVisible();
			const r = option.element().getBoundingClientRect();
			await tap(r.left + r.width / 2, r.top + r.height / 2);
		};
		await tapRow("Arvin");
		await tapRow("Bakersfield");
		await vi.waitFor(() =>
			expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] })
		);
		await page.getByRole("option", { name: /Clovis/ }).click();
		await vi.waitFor(() =>
			expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["3"] })
		);
	});

	it("reads a list row's press, not its click: iOS, Safari before 17, synthetic, cancelled", async () => {
		const { row, seen } = await oneRowList();
		const el = row.element();
		const down = (type: string) =>
			el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: type }));
		const pointerClick = (type: string) =>
			el.dispatchEvent(new PointerEvent("click", { bubbles: true, pointerType: type }));

		// iOS Safari since 18.2: a tap's click says "mouse".
		down("touch");
		pointerClick("mouse");
		// Safari before 17: the click is a plain MouseEvent.
		down("touch");
		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		// A synthetic click after a touch press that never clicked.
		down("touch");
		pointerClick("");
		// A touch press the browser cancelled (a scroll), then a click with no pointer type.
		down("touch");
		el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerType: "touch" }));
		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		// A long-press into the context menu, then a click with no pointer type.
		down("touch");
		el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(seen).toEqual([true, true, false, false, false]);
	});
});
