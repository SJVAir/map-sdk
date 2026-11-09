import { flushSync, tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { FeatureCollection, Geometry } from "geojson";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import type { FeatureListItem, MapPlugin } from "../../src/lib/core/plugin.js";
import type { MapFeatureProperties } from "../../src/lib/data/types.js";
import { shapesPlugin } from "../../src/lib/plugins/shapes.svelte.js";
import { hmsSmokePlugin } from "../../src/lib/presets/hms-smoke.js";
import FeatureList from "../../src/lib/ui/FeatureList.svelte";
import MapTooltip from "../../src/lib/ui/MapTooltip.svelte";
import ViewSummary from "../../src/lib/ui/ViewSummary.svelte";
import { SUMMARY_DEBOUNCE_MS, summaryText } from "../../src/lib/ui/view-summary.js";
import { createFakeGl, type FakeGl } from "../fixtures/fake-gl.js";
import { plumeFeature } from "../fixtures/plume.js";
import { smokeScale } from "../fixtures/scales.js";
import { TestSource } from "../fixtures/sources.svelte.js";

// The fake GL map starts at (-119.7, 36.7), zoom 7: this view.
const VIEW = { west: -122.5125, south: 35.29375, east: -116.8875, north: 38.10625 };
const W = 800;
const H = 600;
const GAP = 12;

/** Lng/lat onto an 800×600 canvas over the fake map's starting view. */
function project([lng, lat]: [number, number]) {
	return {
		x: ((lng - VIEW.west) / (VIEW.east - VIEW.west)) * W,
		y: ((VIEW.north - lat) / (VIEW.north - VIEW.south)) * H
	};
}

type Props = MapFeatureProperties;
const collection = (
	features: Array<{ geometry: Geometry; properties: Props }>
): FeatureCollection<Geometry, Props> => ({
	type: "FeatureCollection",
	features: features.map((f) => ({ type: "Feature", ...f }))
});

const square = (west: number, south: number, east: number, north: number): Geometry => ({
	type: "Polygon",
	coordinates: [
		[
			[west, south],
			[east, south],
			[east, north],
			[west, north],
			[west, south]
		]
	]
});

async function smokeMap(extra: MapPlugin[] = []) {
	const plume = plumeFeature();
	const source = new TestSource<Props>({ features: collection([plume]), scale: smokeScale });
	const map = createMap({ config: { maptilerKey: "test-key" } });
	const smoke = hmsSmokePlugin({ source, layerLabel: "Smoke" });
	map.addPlugin(smoke);
	for (const plugin of extra) map.addPlugin(plugin);
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	await tick();
	map.updateView(map.camera, VIEW);
	flushSync();
	return { map, gl, source, smoke, plume };
}

/** The tooltip's anchor: the middle of its bottom edge, plus the gap. */
function tipAnchor(): { x: number; y: number } {
	const el = page.getByRole("tooltip").element() as HTMLElement;
	const left = parseFloat(el.style.left);
	const top = parseFloat(el.style.top);
	return { x: left + el.offsetWidth / 2, y: top + el.offsetHeight + GAP };
}

const listbox = () => page.getByRole("listbox", { name: "Features on the map" });

async function focusList() {
	await expect.element(listbox()).toBeVisible();
	(listbox().element() as HTMLElement).focus();
	await tick();
}

afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe("a plume that covers the view", () => {
	it("gets a list row", async () => {
		const { map } = await smokeMap();
		render(FeatureList, { map });
		await expect.element(page.getByRole("option", { name: /Smoke/ })).toBeInTheDocument();
		map.destroy();
	});

	it("is counted by the summary", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { map, smoke } = await smokeMap();
		render(ViewSummary, { map });
		map.updateView(map.camera, { ...VIEW, west: VIEW.west + 0.01 });
		await vi.advanceTimersByTimeAsync(SUMMARY_DEBOUNCE_MS);
		await Promise.resolve();
		const expected = summaryText("Smoke", smoke.features!(), smokeScale, map.messages);
		expect(expected).toContain("1");
		const lines = [...document.querySelectorAll(".mapsdk-summary p")].map((p) => p.textContent);
		expect(lines).toContain(expected);
		map.destroy();
	});

	it("focusing its row keeps the camera and pins the tooltip near the middle", async () => {
		const { map, gl } = await smokeMap();
		render(FeatureList, { map });
		render(MapTooltip, { map, project, width: W, height: H });
		await focusList();
		await userEvent.keyboard("{Home}");
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		expect(map.focusedKey).toMatch(/^feature:/);
		expect(gl.getCenter()).toEqual({ lng: -119.7, lat: 36.7 });
		const at = tipAnchor();
		expect(Math.abs(at.x - W / 2)).toBeLessThan(1);
		expect(Math.abs(at.y - H / 2)).toBeLessThan(100);
		map.destroy();
	});

	it("arrowing from a point row onto it leaves the camera where it is", async () => {
		const point: FeatureListItem = {
			refKey: "monitor:1",
			ref: { kind: "monitor", id: "1" },
			name: "Arvin",
			value: null,
			level: smokeScale.levels[0],
			units: "",
			lngLat: [-119, 37],
			selectable: false
		};
		const points: MapPlugin = { id: "points", setup: () => () => {}, features: () => [point] };
		const { map, gl } = await smokeMap([points]);
		render(FeatureList, { map });
		await focusList();
		await userEvent.keyboard("{Home}");
		expect(map.focusedKey).toBe("monitor:1");
		expect(gl.getCenter()).toEqual({ lng: -119, lat: 37 });
		await userEvent.keyboard("{ArrowDown}");
		expect(map.focusedKey).toMatch(/^feature:/);
		expect(gl.moves.at(-1)!.options).toEqual({ center: [-119, 37], duration: 0 });
		map.destroy();
	});

	it("a focused plume gone from the data shows no tooltip", async () => {
		const { map, source, plume } = await smokeMap();
		render(MapTooltip, { map, project, width: W, height: H });
		map.focusFeature(plume.properties.refKey, "hms-smoke");
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		source.features = collection([]);
		flushSync();
		await tick();
		expect(page.getByRole("tooltip").elements()).toHaveLength(0);
		map.destroy();
	});
});

describe("several plumes that overlap and cover the view", () => {
	// The saved light plume, and a heavy one over it whose centroid (-119.5, 30) is off-screen.
	async function twoPlumesMap() {
		const light = plumeFeature();
		const heavy = {
			geometry: square(-124, 20, -115, 40),
			properties: { refKey: "feature:heavy", name: "Smoke", value: "heavy" }
		};
		const source = new TestSource<Props>({
			features: collection([light, heavy]),
			scale: smokeScale
		});
		const map = createMap({ config: { maptilerKey: "test-key" } });
		const smoke = hmsSmokePlugin({ source, layerLabel: "Smoke" });
		map.addPlugin(smoke);
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.updateView(map.camera, VIEW);
		flushSync();
		return { map, gl, smoke };
	}

	it("each gets a list row", async () => {
		const { map } = await twoPlumesMap();
		render(FeatureList, { map });
		await expect.poll(() => page.getByRole("option", { name: /Smoke/ }).elements().length).toBe(2);
		map.destroy();
	});

	it("the summary counts each", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { map, smoke } = await twoPlumesMap();
		render(ViewSummary, { map });
		map.updateView(map.camera, { ...VIEW, west: VIEW.west + 0.01 });
		await vi.advanceTimersByTimeAsync(SUMMARY_DEBOUNCE_MS);
		await Promise.resolve();
		const expected = summaryText("Smoke", smoke.features!(), smokeScale, map.messages);
		expect(expected).toMatch(/Light/);
		expect(expected).toMatch(/Heavy/);
		const lines = [...document.querySelectorAll(".mapsdk-summary p")].map((p) => p.textContent);
		expect(lines).toContain(expected);
		map.destroy();
	});

	it("focusing each row in turn keeps the map still and pins mid-map", async () => {
		const { map, gl } = await twoPlumesMap();
		render(FeatureList, { map });
		render(MapTooltip, { map, project, width: W, height: H });
		await focusList();
		const seen = new Set<string>();
		for (const key of ["{Home}", "{ArrowDown}"]) {
			await userEvent.keyboard(key);
			await expect.element(page.getByRole("tooltip")).toBeVisible();
			seen.add(map.focusedKey!);
			const at = tipAnchor();
			expect(Math.abs(at.x - W / 2)).toBeLessThan(1);
			expect(Math.abs(at.y - H / 2)).toBeLessThan(100);
		}
		expect(seen.size).toBe(2);
		expect(gl.getCenter()).toEqual({ lng: -119.7, lat: 36.7 });
		expect(gl.moves).toEqual([]);
		map.destroy();
	});
});

describe("hovering a shape in pinned mode", () => {
	async function regionsMap(geometry: Geometry) {
		const source = new TestSource<Props>({
			features: collection([
				{ geometry, properties: { refKey: "feature:r1", name: "Fresno County", value: null } }
			])
		});
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(
			shapesPlugin<Props>({ id: "regions", source, layerLabel: "Counties", mode: "plain" })
		);
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.updateView(map.camera, VIEW);
		return { map, gl, geometry };
	}

	function hover(gl: FakeGl, uid: string, geometry: Geometry) {
		gl.setRenderedFeatures([
			{
				layer: { id: `${uid}:regions:fill` },
				source: `${uid}:regions:shapes`,
				properties: { refKey: "feature:r1", name: "Fresno County", value: null },
				geometry
			}
		] as never);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		flushSync();
	}

	it("a shape with its label point off-screen pins inside the view", async () => {
		// Its centroid (-117, 30) is far below the view; it covers the view's center.
		const { map, gl, geometry } = await regionsMap(square(-124, 20, -110, 40));
		render(MapTooltip, { map, project, width: W, height: H });
		hover(gl, map.uid, geometry);
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		const at = tipAnchor();
		expect(Math.abs(at.x - W / 2)).toBeLessThan(1);
		expect(Math.abs(at.y - H / 2)).toBeLessThan(100);
		map.destroy();
	});

	it("a map move during the hover finds the pin point again when the map settles", async () => {
		const { map, gl, geometry } = await regionsMap(square(-124, 20, -110, 40));
		render(MapTooltip, { map, project, width: W, height: H });
		hover(gl, map.uid, geometry);
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		// The pointer rests on the shape while the map pans; MapView reports the new view on moveend.
		gl.jumpTo({ center: [-121, 37.5] });
		const b = gl.getBounds();
		map.updateView(
			{ ...map.camera, center: [-121, 37.5] },
			{ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
		);
		flushSync();
		const expected = project([-121, 37.5]);
		await expect.poll(() => Math.abs(tipAnchor().x - expected.x)).toBeLessThan(1);
		expect(Math.abs(tipAnchor().y - expected.y)).toBeLessThan(100);
		map.destroy();
	});

	it("a shape with its label point on screen anchors there, as today", async () => {
		const { map, gl, geometry } = await regionsMap(square(-119.1, 36.9, -118.9, 37.1));
		render(MapTooltip, { map, project, width: W, height: H });
		hover(gl, map.uid, geometry);
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		const at = tipAnchor();
		const expected = project([-119, 37]);
		expect(Math.abs(at.x - expected.x)).toBeLessThan(1);
		expect(Math.abs(at.y - expected.y)).toBeLessThan(1);
		map.destroy();
	});
});
