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
afterEach(async () => {
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

/** A MapView with one monitor at `SITE`, and the featureclick events it reports. */
async function siteMap() {
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
			source: staticSource(
				{
					type: "FeatureCollection",
					features: [
						{
							type: "Feature",
							geometry: { type: "Point", coordinates: SITE },
							properties: { refKey: "feature:s1", name: "Site", value: 10 }
						}
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
	await vi.waitFor(() => expect(map.featuresAt(gl.project(SITE))).toHaveLength(1));
	return { map, gl, canvas, events };
}

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
