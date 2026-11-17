import { createRawSnippet } from "svelte";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap, pointsPlugin, shapesLens, shapesPlugin } from "../../src/lib/index.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { CardContext } from "../../src/lib/ui/card.js";
import { staticSource } from "../../src/lib/data/static-source.js";
import type { MapFeatureProperties } from "../../src/lib/data/types.js";
import { lensGrid, parentKey } from "../fixtures/lens-grid.js";
import { pm25Scale } from "../fixtures/scales.js";
import { parkPointer } from "./park-pointer.js";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

type Props = MapFeatureProperties;
const style = { version: 8, sources: {}, layers: [] };
const ORIGIN: [number, number] = [-119.9, 36.66];
const SIZE = 0.04;
/** The middle of parent (row, col), or of its child `n` (2×2, row-major from the south-west). */
const at = (row: number, col: number, n?: number): [number, number] => {
	const [x, y] = [ORIGIN[0] + col * SIZE, ORIGIN[1] + row * SIZE];
	if (n === undefined) return [x + SIZE / 2, y + SIZE / 2];
	return [x + ((n % 2) + 0.5) * (SIZE / 2), y + (Math.floor(n / 2) + 0.5) * (SIZE / 2)];
};
const EXPECTED_WARNINGS = [
	/^MapTiler Cloud API key is not set/,
	/^\[webglcontextlost\] .* harmless/
];
const warn = console.warn.bind(console);
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	if (!EXPECTED_WARNINGS.some((re) => re.test(args.map(String).join(" ")))) warn(...args);
});
const sized = document.createElement("style");
sized.textContent = ".lens-map { width: 600px; height: 400px; }";

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

async function lensMap(withNotice = false, inTownship = false) {
	const grid = lensGrid({ origin: ORIGIN, size: SIZE });
	const map = createMap({
		config: {
			maptilerKey: "test-key",
			basemaps: { styles: [{ id: "a", style }], defaultId: "a" },
			initialView: { center: at(2, 2), zoom: 10, bearing: 0, pitch: 0 }
		}
	});
	const parents = shapesPlugin<Props>({
		id: "parents",
		source: staticSource(grid.parents, pm25Scale),
		layerLabel: "Townships",
		mode: "choropleth",
		zoomRange: { max: 11 }
	});
	const sectionCard = createRawSnippet(() => ({
		render: () => `<p>Section figures <a href="#section">Open the section</a></p>`
	}));
	const lens = shapesLens<Props>({
		id: "lens",
		parents,
		source: staticSource(grid.children, pm25Scale),
		block: grid.block,
		parentOf: grid.parentOf,
		layerLabel: "Sections",
		tooltip: () => sectionCard
	});
	map.addPlugin(parents);
	map.addPlugin(lens);
	if (withNotice) {
		map.addPlugin(
			pointsPlugin<Props>({
				id: "notices",
				layerLabel: "Notices",
				circle: { radius: 10 },
				source: staticSource(
					{
						type: "FeatureCollection",
						features: [
							{
								type: "Feature",
								geometry: { type: "Point", coordinates: at(2, 2, 0) },
								properties: { refKey: "feature:n1", name: "Notice", value: 10 }
							}
						]
					},
					pm25Scale
				)
			})
		);
	}
	// With `inTownship`, a section card's "In township" (the dashboard's): the township's card in
	// place of the section's, through `map.pin`.
	const actions = createRawSnippet<[CardContext]>((ctx) => ({
		render: () =>
			inTownship
				? `<span><button type="button">Show square miles</button><button type="button">In township</button></span>`
				: `<button type="button">Show square miles</button>`,
		setup: (el) => {
			const [square, township] =
				el instanceof HTMLButtonElement ? [el] : el.querySelectorAll("button");
			const onSquare = () => lens.pin(ctx().refKey);
			const onTownship = () => {
				const parent = grid.parentOf({ refKey: ctx().refKey } as Props);
				if (ctx().pluginId === "lens" && parent) map.pin("parents", parent);
			};
			square.addEventListener("click", onSquare);
			township?.addEventListener("click", onTownship);
			return () => {
				square.removeEventListener("click", onSquare);
				township?.removeEventListener("click", onTownship);
			};
		}
	}));
	const attached: GlMapLike[] = [];
	const attach = map.attach.bind(map);
	vi.spyOn(map, "attach").mockImplementation((gl) => {
		attached.push(gl);
		attach(gl);
	});
	render(MapView, { map, class: "lens-map", card: { actions }, label: "Lens map" });
	await vi.waitFor(() => expect(map.ready).toBe(true), { timeout: 5000 });
	const gl = attached[0];
	const canvas = gl.getCanvas();
	/** Moves the real mouse to a map point. */
	const pointAt = async (lngLat: [number, number]) => {
		const { x, y } = gl.project(lngLat);
		await page.elementLocator(canvas).hover({ position: { x, y } });
	};
	const clickAt = async (lngLat: [number, number]) => {
		const { x, y } = gl.project(lngLat);
		await page.elementLocator(canvas).click({ position: { x, y } });
	};
	return { map, lens, gl, canvas, pointAt, clickAt };
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("shapesLens in a browser", () => {
	it("hover raises the lens; moving into a neighbour's section recentres; leaving drops it after the grace", async () => {
		const { lens, pointAt } = await lensMap();
		await pointAt(at(2, 2));
		await vi.waitFor(() => expect(lens.center).toBe(parentKey(2, 2)));
		await pointAt(at(2, 3, 1));
		await vi.waitFor(() => expect(lens.center).toBe(parentKey(2, 3)));
		await parkPointer();
		await settle(60);
		expect(lens.center).toBe(parentKey(2, 3));
		await vi.waitFor(() => expect(lens.center).toBeNull(), { timeout: 1000 });
	});

	it("resting on a notice inside the lens keeps it", async () => {
		const { map, lens, pointAt } = await lensMap(true);
		await pointAt(at(2, 2, 0));
		await vi.waitFor(() => expect(map.hovered?.hit.pluginId).toBe("notices"));
		await settle(400);
		expect(lens.center).toBe(parentKey(2, 2));
	});

	it("a click on a township opens its card and doesn't pin the lens; moving onto the card keeps it", async () => {
		const { lens, clickAt } = await lensMap();
		await clickAt(at(4, 4));
		const card = page.getByRole("group", { name: "T4-4" });
		await expect.element(card).toBeVisible();
		expect(lens.pinned).toBe(false);
		await card.hover();
		await settle(400);
		expect(lens.center).toBe(parentKey(4, 4));
	});

	it("Esc drops a hover lens without moving the pointer", async () => {
		const { lens, pointAt } = await lensMap();
		await pointAt(at(2, 2));
		await vi.waitFor(() => expect(lens.center).toBe(parentKey(2, 2)));
		await userEvent.keyboard("{Escape}");
		await vi.waitFor(() => expect(lens.center).toBeNull());
		await settle(200);
		expect(lens.center).toBeNull();
	});

	it("an Esc something else took, or one in another map, leaves a pinned lens", async () => {
		const a = await lensMap();
		const b = await lensMap();
		a.lens.pin(parentKey(2, 2));
		b.lens.pin(parentKey(1, 1));
		await settle(50);
		a.canvas.focus();
		const taken = (e: KeyboardEvent) => e.preventDefault();
		document.addEventListener("keydown", taken, { capture: true });
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
		document.removeEventListener("keydown", taken, { capture: true });
		await settle(50);
		expect(a.lens.pinned).toBe(true);
		// Focus in map b: Esc there releases b's lens only.
		b.canvas.focus();
		await userEvent.keyboard("{Escape}");
		await vi.waitFor(() => expect(b.lens.pinned).toBe(false));
		expect(a.lens.pinned).toBe(true);
	});

	it("Esc with a section card pinned over a hover lens closes the card first", async () => {
		const { lens, pointAt, clickAt } = await lensMap();
		await pointAt(at(2, 2));
		await vi.waitFor(() => expect(lens.center).toBe(parentKey(2, 2)));
		await clickAt(at(2, 2, 3));
		const section = page.getByRole("group", { name: "T2-2 S3" });
		await expect.element(section).toBeVisible();
		(document.activeElement as HTMLElement | null)?.blur();
		await userEvent.keyboard("{Escape}");
		await expect.element(section).not.toBeInTheDocument();
		expect(lens.center).toBe(parentKey(2, 2));
	});

	it("Show square miles pins it, a section card opens inside it, and Esc releases it", async () => {
		const { lens, clickAt, pointAt, gl } = await lensMap();
		await clickAt(at(4, 4));
		const card = page.getByRole("group", { name: "T4-4" });
		await card.getByRole("button", { name: "Show square miles" }).click();
		expect(lens.pinned).toBe(true);
		expect(lens.center).toBe(parentKey(4, 4));
		await pointAt(at(0, 0));
		await settle(300);
		expect(lens.center).toBe(parentKey(4, 4));
		// A section of the block the pinned card doesn't cover.
		const box = card.element().getBoundingClientRect();
		const free = [0, 1, 2, 3]
			.flatMap((n) => [[3, 3, n] as const, [3, 4, n] as const, [4, 3, n] as const])
			.find(([r, c, n]) => {
				const { x, y } = gl.project(at(r, c, n));
				return x < box.left - 8 || x > box.right + 8 || y < box.top - 8 || y > box.bottom + 8;
			})!;
		await clickAt(at(free[0], free[1], free[2]));
		const name = `T${free[0]}-${free[1]} S${free[2]}`;
		const section = page.getByRole("group", { name });
		await expect.element(section.getByRole("link", { name: "Open the section" })).toBeVisible();
		expect(lens.pinned).toBe(true);
		await userEvent.keyboard("{Escape}");
		await expect.element(section).not.toBeInTheDocument();
		await vi.waitFor(() => expect(lens.pinned).toBe(false));
	});

	it("a section card's township button swaps in its township's card and keeps the hover lens", async () => {
		const { lens, gl, pointAt, clickAt } = await lensMap(false, true);
		await pointAt(at(2, 2));
		await vi.waitFor(() => expect(lens.center).toBe(parentKey(2, 2)));
		await clickAt(at(2, 2, 3));
		const section = page.getByRole("group", { name: "T2-2 S3" });
		await expect.element(section).toBeVisible();
		// The lens's tooltip body shows under a hover lens too (the user, 2026-11-17, beta.20).
		await expect.element(section.getByRole("link", { name: "Open the section" })).toBeVisible();
		const { lng, lat } = gl.getCenter();
		const was = section.element().getBoundingClientRect();
		await section.getByRole("button", { name: "In township" }).click();
		const township = page.getByRole("group", { name: "T2-2" });
		await expect.element(township).toBeVisible();
		await expect.element(section).not.toBeInTheDocument();
		// Exactly in place (the user, 2026-11-17): the same anchor, centred over the same point.
		const now = township.element().getBoundingClientRect();
		expect(Math.abs(now.left + now.width / 2 - (was.left + was.width / 2))).toBeLessThan(1);
		expect(Math.min(Math.abs(now.bottom - was.bottom), Math.abs(now.top - was.top))).toBeLessThan(
			1
		);
		expect(gl.getCenter().lng).toBe(lng);
		expect(gl.getCenter().lat).toBe(lat);
		// A township outside the block the card doesn't cover.
		const box = township.element().getBoundingClientRect();
		const canvasBox = gl.getCanvas().getBoundingClientRect();
		const free = (
			[
				[0, 0],
				[0, 2],
				[0, 4],
				[2, 0],
				[2, 4],
				[4, 0],
				[4, 2],
				[4, 4]
			] as const
		).find(([r, c]) => {
			const { x, y } = gl.project(at(r, c));
			const [px, py] = [x + canvasBox.left, y + canvasBox.top];
			return px < box.left - 8 || px > box.right + 8 || py < box.top - 8 || py > box.bottom + 8;
		})!;
		await pointAt(at(free[0], free[1]));
		await settle(300);
		expect(lens.center).toBe(parentKey(2, 2));
		expect(lens.pinned).toBe(false);
		await userEvent.keyboard("{Escape}");
		await expect.element(township).not.toBeInTheDocument();
		await pointAt(at(free[0], free[1], 0));
		await vi.waitFor(() => expect(lens.center).toBe(parentKey(free[0], free[1])));
	});

	it("hovering a section under a hover lens shows its tooltip body", async () => {
		const { lens, pointAt } = await lensMap();
		await pointAt(at(2, 2));
		await vi.waitFor(() => expect(lens.center).toBe(parentKey(2, 2)));
		await pointAt(at(2, 2, 1));
		await vi.waitFor(() =>
			expect(document.querySelector(".mapsdk-tooltip")?.textContent).toContain("Section figures")
		);
	});

	it("keyboard: the township button moves focus into the township's card and keeps a pinned lens", async () => {
		const { lens, clickAt } = await lensMap(false, true);
		await clickAt(at(2, 2));
		const township = page.getByRole("group", { name: "T2-2" });
		await township.getByRole("button", { name: "Show square miles" }).click();
		expect(lens.pinned).toBe(true);
		await clickAt(at(2, 2, 0));
		const section = page.getByRole("group", { name: "T2-2 S0" });
		const button = section.getByRole("button", { name: "In township" });
		await expect.element(button).toBeVisible();
		(button.element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		await expect.element(township).toHaveFocus();
		expect(lens.pinned).toBe(true);
		expect(lens.center).toBe(parentKey(2, 2));
	});

	it("a touch tap opens the card only", async () => {
		const { lens, canvas, gl } = await lensMap();
		const { x, y } = gl.project(at(1, 1));
		const rect = canvas.getBoundingClientRect();
		const init = { clientX: rect.left + x, clientY: rect.top + y, bubbles: true };
		canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "touch" }));
		canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "touch" }));
		// The browser's emulated mouse events after a tap.
		canvas.dispatchEvent(new MouseEvent("mousemove", init));
		await settle(200);
		expect(lens.center).toBeNull();
	});

	it("two maps with lenses don't share one", async () => {
		const a = await lensMap();
		const b = await lensMap();
		await a.pointAt(at(2, 2));
		await vi.waitFor(() => expect(a.lens.center).toBe(parentKey(2, 2)));
		expect(b.lens.center).toBeNull();
	});
});

export type { MapContext };
