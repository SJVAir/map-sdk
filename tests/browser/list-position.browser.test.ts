import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap } from "../../src/lib/index.js";
import type { FeatureListOptions, ListPosition } from "../../src/lib/index.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import { NO_LEVEL } from "../../src/lib/data/scale.js";
import { flushSync } from "svelte";
import MapViewListOptions from "../fixtures/MapViewListOptions.svelte";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

/** An attribution, so the engine's credits render. */
const style = {
	version: 8,
	sources: {
		base: {
			type: "geojson",
			data: { type: "FeatureCollection", features: [] },
			attribution: "&copy; MapTiler &copy; OpenStreetMap contributors"
		}
	},
	layers: [{ id: "dots", type: "circle", source: "base" }]
};

/**
 * The listed features: `count` of them around `lngLat` (the first exactly there). Tests set these
 * before opening the list; many rows make the panel as tall as it may be.
 */
const probe = { lngLat: [-119.8, 36.76] as [number, number], count: 1 };

function newMap(): MapContext {
	const map = createMap({
		config: {
			maptilerKey: "test-key",
			basemaps: { styles: [{ id: "a", style }], defaultId: "a" }
		}
	});
	map.addPlugin(
		{
			id: "monitors",
			label: "monitors",
			setup: () => () => {},
			features: () =>
				Array.from({ length: probe.count }, (_, i) => ({
					refKey: `monitor:${i + 1}`,
					ref: { kind: "monitor", id: `${i + 1}` },
					name: `Probe ${i + 1}`,
					value: 5,
					level: NO_LEVEL,
					units: "u",
					lngLat: [probe.lngLat[0] + i * 0.001, probe.lngLat[1]] as [number, number],
					selectable: true
				}))
		},
		{ selectionMode: "single" }
	);
	return map;
}

function trackAttach(map: MapContext): GlMapLike[] {
	const attached: GlMapLike[] = [];
	const attach = map.attach.bind(map);
	vi.spyOn(map, "attach").mockImplementation((gl) => {
		attached.push(gl);
		attach(gl);
	});
	return attached;
}

function whenLoaded(gl: GlMapLike): Promise<void> {
	return new Promise((resolve) => {
		if ((gl as unknown as { loaded(): boolean }).loaded()) resolve();
		else gl.on("load", () => resolve());
	});
}

const sized = document.createElement("style");
sized.textContent =
	".wide-map { width: 600px; height: 400px; } .short-map { width: 600px; height: 240px; }";
const requests: string[] = [];
const EXPECTED_WARNINGS = [
	/^MapTiler Cloud API key is not set/,
	/^\[webglcontextlost\] .* harmless/
];
const warn = console.warn.bind(console);
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	if (!EXPECTED_WARNINGS.some((re) => re.test(args.map(String).join(" ")))) warn(...args);
});

beforeAll(() => {
	maptilerConfig.telemetry = false;
	document.head.append(sized);
	vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
		requests.push(input instanceof Request ? input.url : String(input));
		return Promise.reject(new TypeError("offline"));
	});
});

afterEach(() => {
	document.body.replaceChildren();
	probe.lngLat = [-119.8, 36.76];
	probe.count = 1;
});

afterAll(() => {
	expect(requests).toEqual([]);
});

type Controls = "mapsdk" | "engine" | "none";

async function show(
	featureList: boolean | FeatureListOptions,
	controls: Controls = "engine",
	className = "wide-map"
) {
	const map = newMap();
	const attached = trackAttach(map);
	const view = await render(MapView, { map, class: className, controls, featureList });
	await whenLoaded(attached[0]);
	// The credits render after the style loads.
	await vi.waitFor(() => expect(document.querySelector(".maplibregl-ctrl-attrib")).not.toBeNull());
	return { map, attached, view };
}

const root = () => document.querySelector<HTMLElement>("[data-mapsdk-map]")!;
const button = () => document.querySelector<HTMLElement>(".mapsdk-list-button")!;
const rectOf = (el: Element) => el.getBoundingClientRect();

function intersects(a: DOMRect, b: DOMRect): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The controls the engine or map-sdk draws, each a rect a List button must not cover. */
function controlRects(): DOMRect[] {
	const els = document.querySelectorAll(
		"[class*='maplibregl-ctrl-top'] > *, [class*='maplibregl-ctrl-bottom'] > *, .mapsdk-zoom"
	);
	return [...els].map(rectOf).filter((r) => r.width > 0 && r.height > 0);
}

/** The bottom (top corners) or top (bottom corners) of the engine's controls in a corner. */
function cornerEdge(corner: ListPosition): number {
	const r = rectOf(document.querySelector(`.maplibregl-ctrl-${corner}`)!);
	return corner.startsWith("top") ? r.bottom : r.top;
}

async function openList() {
	button().click();
	const listbox = page.getByRole("listbox", { name: "Features on the map" });
	await expect.element(listbox).toBeVisible();
	return document.getElementById(button().getAttribute("aria-controls")!)!;
}

const positions: ListPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const controlsValues: Controls[] = ["mapsdk", "engine", "none"];

describe("featureList position", () => {
	it.each(positions.flatMap((p) => controlsValues.map((c) => [p, c] as const)))(
		"%s with controls %s: in its corner, clear of the controls",
		async (position, controls) => {
			await show({ position }, controls);
			await vi.waitFor(() => {
				const map = rectOf(root());
				const b = rectOf(button());
				const [vertical, horizontal] = position.split("-");
				// 0.75rem from the side edge.
				const side = horizontal === "left" ? b.left - map.left : map.right - b.right;
				expect(side).toBeCloseTo(12, 0);
				// 0.75rem from the top or bottom edge, or further when controls are there.
				const fromEdge = vertical === "top" ? b.top - map.top : map.bottom - b.bottom;
				expect(fromEdge).toBeGreaterThanOrEqual(11.5);
				expect(b.top).toBeGreaterThanOrEqual(map.top);
				expect(b.bottom).toBeLessThanOrEqual(map.bottom);
				for (const r of controlRects()) expect(intersects(b, r)).toBe(false);
			});
		}
	);

	it("stacks below the engine's controls top-right", async () => {
		await show({ position: "top-right" }, "engine");
		await vi.waitFor(() => {
			const gap = rectOf(button()).top - cornerEdge("top-right");
			expect(gap).toBeGreaterThanOrEqual(0);
			expect(gap).toBeLessThanOrEqual(9);
		});
	});

	it("stacks below map-sdk's zoom buttons top-right", async () => {
		await show({ position: "top-right" }, "mapsdk");
		await vi.waitFor(() => {
			const gap = rectOf(button()).top - rectOf(document.querySelector(".mapsdk-zoom")!).bottom;
			expect(gap).toBeGreaterThanOrEqual(0);
			expect(gap).toBeLessThanOrEqual(9);
		});
	});

	it.each(positions)("%s: the panel opens toward the middle", async (position) => {
		await show({ position }, "engine");
		const panel = await openList();
		await vi.waitFor(() => {
			const p = rectOf(panel);
			const b = rectOf(button());
			if (position.startsWith("top")) expect(p.top).toBeGreaterThan(b.bottom);
			else expect(p.bottom).toBeLessThan(b.top);
			const map = rectOf(root());
			expect(p.top).toBeGreaterThanOrEqual(map.top);
			expect(p.bottom).toBeLessThanOrEqual(map.bottom);
		});
	});

	it("a top-right panel stops short of the credits", async () => {
		probe.count = 30;
		await show({ position: "top-right" }, "engine");
		const panel = await openList();
		await vi.waitFor(() =>
			expect(rectOf(panel).bottom).toBeLessThanOrEqual(cornerEdge("bottom-right"))
		);
	});

	it("a bottom-right panel stops short of the engine's controls", async () => {
		probe.count = 30;
		await show({ position: "bottom-right" }, "engine");
		const panel = await openList();
		await vi.waitFor(() =>
			expect(rectOf(panel).top).toBeGreaterThanOrEqual(cornerEdge("top-right"))
		);
	});

	it("follows the credits as they change size", async () => {
		probe.count = 30;
		await show({ position: "top-right" }, "engine");
		root().style.width = "1000px";
		const panel = await openList();
		await vi.waitFor(() =>
			expect(rectOf(panel).bottom).toBeCloseTo(cornerEdge("bottom-right") - 8, 0)
		);
		const before = cornerEdge("bottom-right");
		// The engine collapses the credits on a narrow map, where they wrap and grow taller.
		root().style.width = "200px";
		await vi.waitFor(() => expect(cornerEdge("bottom-right")).toBeLessThan(before));
		await vi.waitFor(() =>
			expect(rectOf(panel).bottom).toBeCloseTo(cornerEdge("bottom-right") - 8, 0)
		);
	});

	it("fits a short map", async () => {
		probe.count = 30;
		await show({ position: "top-right" }, "engine", "short-map");
		const panel = await openList();
		await vi.waitFor(() => {
			const p = rectOf(panel);
			const map = rectOf(root());
			expect(p.height).toBeGreaterThan(0);
			expect(p.top).toBeGreaterThanOrEqual(map.top);
			expect(p.bottom).toBeLessThanOrEqual(cornerEdge("bottom-right"));
		});
	});

	it("re-places after active toggles", async () => {
		const { attached, view } = await show({ position: "top-right" }, "engine");
		await view.rerender({ active: false });
		await view.rerender({ active: true });
		await whenLoaded(attached[1]);
		await vi.waitFor(() => {
			const gap = rectOf(button()).top - cornerEdge("top-right");
			expect(gap).toBeGreaterThanOrEqual(0);
			expect(gap).toBeLessThanOrEqual(9);
		});
	});

	it("moves when the options change, without rebuilding the map", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		const { component } = await render(MapViewListOptions, { map });
		await whenLoaded(attached[0]);
		flushSync(() => component.setFeatureList({ position: "bottom-left" }));
		await vi.waitFor(() => {
			const m = rectOf(root());
			const b = rectOf(button());
			expect(b.left - m.left).toBeCloseTo(12, 0);
			expect(m.bottom - b.bottom).toBeLessThan(m.height / 2);
		});
		expect(attached).toHaveLength(1);
	});

	it("pans a focused feature clear of a right-hand panel", async () => {
		const { map, attached } = await show({ position: "top-right" }, "mapsdk");
		const gl = attached[0] as GlMapLike & {
			unproject(point: [number, number]): { lng: number; lat: number };
		};
		const canvas = rectOf(gl.getCanvas());
		// Near the right edge, where the panel opens.
		const at = gl.unproject([canvas.width - 60, canvas.height / 2]);
		probe.lngLat = [at.lng, at.lat];
		const panel = await openList();
		const panelLeft = rectOf(panel).left - canvas.left;
		expect(gl.project(probe.lngLat).x).toBeGreaterThan(panelLeft);
		map.focusFeature("monitor:1", "monitors");
		await vi.waitFor(() => {
			const { x } = gl.project(probe.lngLat);
			expect(x).toBeLessThan(panelLeft);
			expect(x).toBeGreaterThan(0);
		});
	});

	it("the selection bar leaves room for a top-right button with no controls", async () => {
		const { map } = await show({ position: "top-right" }, "none");
		map.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		await vi.waitFor(() => expect(document.querySelector(".mapsdk-selection")).not.toBeNull());
		const bar = document.querySelector<HTMLElement>(".mapsdk-selection")!;
		// The same 5rem it leaves on the left for a top-left button.
		expect(getComputedStyle(bar).right).toBe("80px");
	});

	it("the selection bar keeps its usual insets otherwise", async () => {
		const { map } = await show({ position: "top-right" }, "engine");
		map.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		await vi.waitFor(() => expect(document.querySelector(".mapsdk-selection")).not.toBeNull());
		const bar = document.querySelector<HTMLElement>(".mapsdk-selection")!;
		expect(getComputedStyle(bar).right).toBe("64px");
		expect(getComputedStyle(bar).left).toBe("80px");
	});
});
