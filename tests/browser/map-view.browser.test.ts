import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap } from "../../src/lib/index.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import {
	createGlMap,
	defaultBasemaps,
	maptilerKeyTransform
} from "../../src/lib/view/create-gl-map.js";
import { NO_LEVEL } from "../../src/lib/data/scale.js";
import MapViewWithOverlay from "../fixtures/MapViewWithOverlay.svelte";

// The browser project resolves with the "browser" condition only, so esm-env's DEV would be
// false; a Vite host in development gets true.
vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

/** Inline styles, so no style document, key, or network is needed. */
const basemaps = {
	styles: [
		{ id: "a", style: { version: 8, sources: {}, layers: [] } },
		{
			id: "b",
			style: {
				version: 8,
				sources: {},
				layers: [{ id: "b-background", type: "background", paint: {} }]
			}
		}
	],
	defaultId: "a"
};

function newMap(): MapContext {
	return createMap({ config: { maptilerKey: "test-key", basemaps } });
}

/** Records every GL map the context is attached to. */
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
	".test-map { width: 320px; height: 240px; } .wide-map { width: 600px; height: 400px; }";

/** Every request made, which must stay empty: the tests run offline, with no key. */
const requests: string[] = [];
const errors = vi.spyOn(console, "error");

/**
 * MapTiler's SDK warns on every map when its global key is unset (each map's key goes on its
 * own requests instead), and after every removal that the lost WebGL context "is harmless".
 */
const EXPECTED_WARNINGS = [
	/^MapTiler Cloud API key is not set/,
	/^\[webglcontextlost\] .* harmless/
];
const warn = console.warn.bind(console);
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	if (!EXPECTED_WARNINGS.some((re) => re.test(args.map(String).join(" ")))) warn(...args);
});

beforeAll(() => {
	// Telemetry is the one request MapTiler's SDK makes on its own; keep the tests offline.
	maptilerConfig.telemetry = false;
	document.head.append(sized);
	vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
		requests.push(input instanceof Request ? input.url : String(input));
		return Promise.reject(new TypeError("offline"));
	});
});

afterEach(() => {
	document.body.replaceChildren();
});

afterAll(() => {
	expect(requests).toEqual([]);
	expect(errors).not.toHaveBeenCalled();
});

describe("MapView", () => {
	it("gives two maps on one page their own canvas and camera", async () => {
		const mapA = newMap();
		const mapB = newMap();
		const attachedA = trackAttach(mapA);
		const attachedB = trackAttach(mapB);
		const a = await render(MapView, { map: mapA, class: "test-map" });
		const b = await render(MapView, { map: mapB, class: "test-map" });
		const canvasA = a.container.querySelectorAll("canvas");
		const canvasB = b.container.querySelectorAll("canvas");
		expect(canvasA).toHaveLength(1);
		expect(canvasB).toHaveLength(1);
		expect(canvasA[0]).not.toBe(canvasB[0]);
		expect(mapA.attached).toBe(true);
		expect(mapB.attached).toBe(true);

		await Promise.all([whenLoaded(attachedA[0]), whenLoaded(attachedB[0])]);
		const cameraB = mapB.camera;
		const boundsB = mapB.bounds;
		attachedA[0].jumpTo({ center: [-121, 38], zoom: 10 });
		expect(mapA.camera.center[0]).toBeCloseTo(-121);
		expect(mapB.camera).toEqual(cameraB);
		expect(mapB.bounds).toEqual(boundsB);
		expect(attachedB[0].getCenter().lng).toBeCloseTo(cameraB.center[0]);
	});

	it("refuses to create a GL map when the current basemap has no style", async () => {
		const map = createMap({
			config: { maptilerKey: "test-key", basemaps: { styles: [], defaultId: "missing" } }
		});
		const container = document.createElement("div");
		document.body.append(container);
		expect(() => createGlMap(container, map)).toThrow('map-sdk: no basemap style for "missing"');
		expect(container.querySelector("canvas")).toBeNull();
	});

	it("sets ready after the first idle", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		expect(map.ready).toBe(false);
		await render(MapView, { map, class: "test-map" });
		await vi.waitFor(() => expect(map.ready).toBe(true));
		expect(map.gl).toBe(attached[0]);
	});

	it("goes back to not ready when unmounted before the first idle", async () => {
		const map = newMap();
		const { unmount } = await render(MapView, { map, class: "test-map" });
		unmount();
		expect(map.ready).toBe(false);
		expect(map.gl).toBeNull();
		await new Promise((r) => setTimeout(r, 300));
		expect(map.ready).toBe(false);
	});

	it("marks its container with the map's uid", async () => {
		const map = newMap();
		const { container } = await render(MapView, { map, class: "test-map" });
		expect(container.querySelector(`[data-mapsdk-map="${map.uid}"]`)).not.toBeNull();
		expect(container.querySelector("[data-mapsdk-map] canvas")).not.toBeNull();
	});

	it("releases the GL map when inactive and rebuilds it with the same camera", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		const { container, rerender } = await render(MapView, { map, class: "test-map" });
		await whenLoaded(attached[0]);
		attached[0].jumpTo({ center: [-120.5, 37.25], zoom: 9, bearing: 15, pitch: 10 });
		expect(map.camera.center[0]).toBeCloseTo(-120.5);
		expect(map.bounds).not.toBeNull();

		await rerender({ active: false });
		expect(container.querySelector("canvas")).toBeNull();
		expect(map.attached).toBe(false);

		await rerender({ active: true });
		expect(container.querySelectorAll("canvas")).toHaveLength(1);
		expect(attached).toHaveLength(2);
		const gl = attached[1];
		expect(gl).not.toBe(attached[0]);
		expect(gl.getCenter().lng).toBeCloseTo(-120.5);
		expect(gl.getCenter().lat).toBeCloseTo(37.25);
		expect(gl.getZoom()).toBeCloseTo(9);
		expect(gl.getBearing()).toBeCloseTo(15);
		expect(gl.getPitch()).toBeCloseTo(10);
	});

	it("starts at the context's camera and records it once loaded", async () => {
		const map = createMap({
			config: {
				maptilerKey: "test-key",
				basemaps,
				initialView: { center: [-118, 35], zoom: 6, bearing: 0, pitch: 0 }
			}
		});
		const attached = trackAttach(map);
		await render(MapView, { map, class: "test-map" });
		expect(attached[0].getCenter().lng).toBeCloseTo(-118);
		expect(attached[0].getZoom()).toBeCloseTo(6);
		await whenLoaded(attached[0]);
		const b = attached[0].getBounds();
		expect(map.bounds).toEqual({
			west: b.getWest(),
			south: b.getSouth(),
			east: b.getEast(),
			north: b.getNorth()
		});
	});

	it("detaches the context, then removes the GL map, on unmount", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		const detach = vi.spyOn(map, "detach");
		const { container, unmount } = await render(MapView, { map, class: "test-map" });
		const remove = vi.spyOn(attached[0], "remove");
		await unmount();
		expect(detach).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledOnce();
		expect(detach.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
		expect(map.attached).toBe(false);
		expect(container.querySelector("canvas")).toBeNull();
	});

	it("creates the GL map with the current basemap's style", async () => {
		const map = newMap();
		map.basemap.select("b");
		const attached = trackAttach(map);
		await render(MapView, { map, class: "test-map" });
		await whenLoaded(attached[0]);
		expect(attached[0].getLayer("b-background")).toBeTruthy();
	});

	it("is a region named by its label, or the default map label", async () => {
		await render(MapView, { map: newMap(), class: "test-map" });
		await render(MapView, { map: newMap(), class: "test-map", label: "Air quality map" });
		await expect
			.element(
				page.getByRole("region", { name: "Map. Use arrow keys to pan, plus and minus to zoom." })
			)
			.toBeInTheDocument();
		await expect.element(page.getByRole("region", { name: "Air quality map" })).toBeInTheDocument();
		expect(document.querySelector('[role="application"]')).toBeNull();
	});

	it("gives overlays the map context", async () => {
		const map = newMap();
		const { container } = await render(MapViewWithOverlay, { map });
		const probe = container.querySelector('[data-testid="map-context-probe"]');
		expect(probe?.textContent).toBe(map.uid);
		expect(probe?.closest("[data-mapsdk-map]")?.getAttribute("data-mapsdk-map")).toBe(map.uid);
	});

	it("answers MapTiler's telemetry after removal (hidden within its 2 s timer)", async () => {
		// The SDK's telemetry timer asks every map `isGlobeProjection()` 2 s after creation,
		// whether or not the map was removed meanwhile; a removed map has no style to ask.
		const container = document.createElement("div");
		container.className = "test-map";
		document.body.append(container);
		const gl = createGlMap(container, newMap()) as unknown as {
			remove(): void;
			isGlobeProjection(): boolean;
		};
		gl.remove();
		expect(gl.isGlobeProjection()).toBe(false);
	});

	describe("projection and space", () => {
		async function glFor(config: Partial<Parameters<typeof createMap>[0]["config"]>) {
			const container = document.createElement("div");
			container.className = "test-map";
			document.body.append(container);
			const map = createMap({ config: { maptilerKey: "test-key", basemaps, ...config } });
			const gl = createGlMap(container, map) as unknown as GlMapLike & {
				isGlobeProjection(): boolean;
				options: Record<string, unknown>;
				remove(): void;
			};
			await whenLoaded(gl);
			return gl;
		}

		it("globe projection reaches the map", async () => {
			const gl = await glFor({ projection: "globe" });
			expect(gl.isGlobeProjection()).toBe(true);
			gl.remove();
		});

		it("default stays mercator, with no projection or space options", async () => {
			const gl = await glFor({});
			expect(gl.isGlobeProjection()).toBe(false);
			expect("projection" in gl.options).toBe(false);
			expect("space" in gl.options).toBe(false);
			gl.remove();
		});

		it("passes a space preset through, and omits space: false", async () => {
			const withSpace = await glFor({ space: { preset: "milkyway" } });
			expect(withSpace.options.space).toEqual({ preset: "milkyway" });
			withSpace.remove();
			const off = await glFor({ space: false });
			expect("space" in off.options).toBe(false);
			off.remove();
		});
	});

	describe("telemetry option", () => {
		const saved = { telemetry: false, session: true };
		beforeEach(() => {
			saved.telemetry = maptilerConfig.telemetry;
			saved.session = maptilerConfig.session;
			// MapTiler's defaults, which the suite's beforeAll changed for telemetry.
			maptilerConfig.telemetry = true;
			maptilerConfig.session = true;
		});
		afterEach(() => {
			maptilerConfig.telemetry = saved.telemetry;
			maptilerConfig.session = saved.session;
		});
		function create(config: Partial<Parameters<typeof createMap>[0]["config"]>) {
			const container = document.createElement("div");
			container.className = "test-map";
			document.body.append(container);
			const map = createMap({ config: { maptilerKey: "test-key", basemaps, ...config } });
			return createGlMap(container, map);
		}

		it("telemetry: false turns MapTiler's telemetry and session id off", () => {
			const gl = create({ telemetry: false });
			expect(maptilerConfig.telemetry).toBe(false);
			expect(maptilerConfig.session).toBe(false);
			gl.remove();
		});

		it("leaves MapTiler's settings alone by default", () => {
			const gl = create({});
			expect(maptilerConfig.telemetry).toBe(true);
			expect(maptilerConfig.session).toBe(true);
			gl.remove();
		});
	});

	it("never sets MapTiler's global key", async () => {
		const before = maptilerConfig.apiKey;
		await render(MapView, { map: newMap(), class: "test-map" });
		expect(maptilerConfig.apiKey).toBe(before);
	});
});

describe("maptilerKeyTransform", () => {
	it("adds the map's own key to MapTiler API requests only", () => {
		const transform = maptilerKeyTransform("key-a");
		const host = maptilerConfig.apiHost;
		expect(transform(`https://${host}/maps/streets-v4/style.json`).url).toBe(
			`https://${host}/maps/streets-v4/style.json?key=key-a`
		);
		expect(transform(`https://${host}/tiles/v3/tiles.json?key=other`).url).toBe(
			`https://${host}/tiles/v3/tiles.json?key=other`
		);
		expect(transform("https://example.com/style.json").url).toBe("https://example.com/style.json");
		expect(transform("not a url").url).toBe("not a url");
	});
});

describe("defaultBasemaps", () => {
	it("lists the Streets v4 variants as style URLs, without the busy POI layers", () => {
		const config = defaultBasemaps();
		expect(config.defaultId).toBe("streets-v4");
		expect(config.styles.map((s) => s.id)).toEqual([
			"streets-v4",
			"streets-v4-dark",
			"streets-v4-pastel"
		]);
		for (const { style } of config.styles) {
			expect(style).toMatch(/^https:\/\/.+\/style\.json$/);
		}
		expect(config.excludedLayers).toEqual([
			"Sport",
			"Tourism",
			"Culture",
			"Shopping",
			"Food",
			"Transport"
		]);
	});
});

describe("MapView tooltip", () => {
	it("follows the camera and stops listening on unmount", async () => {
		const map = newMap();
		map.addPlugin({
			id: "probe",
			setup: () => () => {},
			features: () => [
				{
					refKey: "p:1",
					ref: { type: "monitor", id: "1" } as never,
					name: "Probe",
					value: 5,
					level: NO_LEVEL,
					units: "u",
					lngLat: [-119.8, 36.7],
					selectable: true
				}
			]
		});
		const attached = trackAttach(map);
		const { unmount } = await render(MapView, { map, class: "test-map" });
		const gl = attached[0];
		await whenLoaded(gl);
		map.focusFeature("p:1");
		const tip = page.getByRole("tooltip");
		await expect.element(tip).toBeVisible();
		const left = () => (tip.element() as HTMLElement).style.left;
		const before = left();
		gl.jumpTo({ center: [-119.7, 36.7], zoom: 12 });
		await vi.waitFor(() => expect(left()).not.toBe(before));

		const off = vi.spyOn(gl, "off");
		await unmount();
		const types = off.mock.calls.map((c) => c[0]);
		expect(types).toContain("move");
		expect(types).toContain("resize");
	});
});

describe("MapView map prop", () => {
	it("warns in development when the map prop changes after mount", async () => {
		const spy = vi.mocked(console.warn);
		spy.mockClear();
		const first = newMap();
		const { rerender, unmount } = await render(MapView, { map: first, class: "test-map" });
		const changed = () =>
			spy.mock.calls.filter((args) => String(args[0]).includes("`map` prop changed"));
		expect(changed()).toHaveLength(0);
		await rerender({ map: newMap() });
		await vi.waitFor(() => expect(changed()).toHaveLength(1));
		await unmount();
	});
});

describe("MapView list button", () => {
	it("toggles the feature list panel, and Escape closes it and returns focus", async () => {
		const map = newMap();
		map.addPlugin(
			{
				id: "probe",
				setup: () => () => {},
				features: () => [
					{
						refKey: "monitor:1",
						ref: { kind: "monitor", id: "1" },
						name: "Probe",
						value: 5,
						level: NO_LEVEL,
						units: "u",
						lngLat: [-119.8, 36.7],
						selectable: true
					}
				]
			},
			{ selectionMode: "single" }
		);
		const attached = trackAttach(map);
		await render(MapView, { map, class: "test-map" });
		await whenLoaded(attached[0]);
		const button = page.getByRole("button", { name: "List of features on the map" });
		// The next tab stop after the map canvas.
		attached[0].getCanvas().focus();
		await userEvent.tab();
		expect(document.activeElement).toBe(button.element());
		await expect.element(button).toHaveAttribute("aria-expanded", "false");
		// Closed, the list isn't mounted (and doesn't sort features on every move).
		expect(button.element().hasAttribute("aria-controls")).toBe(false);
		expect(document.querySelector("[role=listbox]")).toBeNull();

		await button.click();
		await expect.element(button).toHaveAttribute("aria-expanded", "true");
		const listbox = page.getByRole("listbox", { name: "Features on the map" });
		await expect.element(listbox).toBeVisible();
		const panel = document.getElementById(button.element().getAttribute("aria-controls")!)!;
		expect(panel.contains(listbox.element())).toBe(true);
		expect(panel.closest("[data-mapsdk-map]")?.getAttribute("data-mapsdk-map")).toBe(map.uid);

		// The sort order survives closing and opening.
		await page.getByRole("button", { name: "Value" }).click();
		await button.click();
		await button.click();
		await expect
			.element(page.getByRole("button", { name: "Value" }))
			.toHaveAttribute("aria-pressed", "true");
		(listbox.element() as HTMLElement).focus();
		await userEvent.keyboard("{Escape}");
		await expect.element(button).toHaveAttribute("aria-expanded", "false");
		expect(document.activeElement).toBe(button.element());
	});

	it("pans a focused feature clear of the open list panel", async () => {
		const map = newMap();
		// West of the start center, so it starts under the panel.
		const lngLat: [number, number] = [-120.0, 36.7];
		map.addPlugin({
			id: "probe",
			setup: () => () => {},
			features: () => [
				{
					refKey: "monitor:1",
					ref: { kind: "monitor", id: "1" },
					name: "Probe",
					value: 5,
					level: NO_LEVEL,
					units: "u",
					lngLat,
					selectable: true
				}
			]
		});
		const attached = trackAttach(map);
		await render(MapView, { map, class: "wide-map" });
		const gl = attached[0];
		await whenLoaded(gl);
		await page.getByRole("button", { name: "List of features on the map" }).click();
		const listbox = page.getByRole("listbox", { name: "Features on the map" });
		await expect.element(listbox).toBeVisible();
		const mapBox = gl.getCanvas().getBoundingClientRect();
		const panelRight = listbox.element().getBoundingClientRect().right - mapBox.left;

		expect(gl.project(lngLat).x).toBeLessThan(panelRight);
		map.focusFeature("monitor:1", "probe");
		await vi.waitFor(() => {
			const { x } = gl.project(lngLat);
			expect(x).toBeGreaterThan(panelRight);
			expect(x).toBeLessThan(mapBox.width);
		});
	});

	it("leaves no padding behind once the list closes", async () => {
		const map = newMap();
		const lngLat: [number, number] = [-120.0, 36.7];
		map.addPlugin({
			id: "probe",
			setup: () => () => {},
			features: () => [
				{
					refKey: "monitor:1",
					ref: { kind: "monitor", id: "1" },
					name: "Probe",
					value: 5,
					level: NO_LEVEL,
					units: "u",
					lngLat,
					selectable: true
				}
			]
		});
		const attached = trackAttach(map);
		await render(MapView, { map, class: "wide-map" });
		const gl = attached[0] as GlMapLike & {
			getPadding(): { top: number; right: number; bottom: number; left: number };
			unproject(point: [number, number]): { lng: number; lat: number };
			isMoving(): boolean;
		};
		await whenLoaded(gl);
		const button = page.getByRole("button", { name: "List of features on the map" });
		await button.click();
		const listbox = page.getByRole("listbox", { name: "Features on the map" });
		await expect.element(listbox).toBeVisible();
		await page.getByRole("option", { name: /Probe/ }).click();
		await vi.waitFor(() => expect(gl.isMoving()).toBe(false));
		await button.click();
		await expect.element(listbox).not.toBeInTheDocument();

		expect(gl.getPadding()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
		const { width, height } = gl.getCanvas().getBoundingClientRect();
		const visual = gl.unproject([width / 2, height / 2]);
		const center = gl.getCenter();
		expect(center.lng).toBeCloseTo(visual.lng, 6);
		expect(center.lat).toBeCloseTo(visual.lat, 6);
	});

	it("leaves the button out when featureList is false", async () => {
		const map = newMap();
		const { container } = await render(MapView, { map, class: "test-map", featureList: false });
		const root = container.querySelector(`[data-mapsdk-map="${map.uid}"]`)!;
		expect(root).not.toBeNull();
		expect(root.querySelector(".mapsdk-list-button, [role=listbox]")).toBeNull();
	});
});

describe("createMap", () => {
	it("defaults the basemaps to MapTiler Streets v4", () => {
		const map = createMap({ config: { maptilerKey: "test-key" } });
		expect(map.basemap.current).toBe("streets-v4");
		map.basemap.select("streets-v4-dark");
		expect(map.basemap.current).toBe("streets-v4-dark");
	});

	it("sets plugins up again when the host's theme changes, and not after unmount", async () => {
		const theme = document.createElement("style");
		theme.textContent =
			':root { --muted: #eeeeee; } :root[data-theme="dark"] { --muted: #222222; }';
		document.head.append(theme);
		try {
			const map = newMap();
			let setups = 0;
			map.addPlugin({
				id: "probe",
				setup: () => {
					setups++;
					return () => {};
				}
			});
			const attached = trackAttach(map);
			const { unmount } = await render(MapView, { map, class: "test-map" });
			await whenLoaded(attached[0]);
			const before = setups;
			expect(before).toBe(1);

			document.documentElement.setAttribute("data-theme", "dark");
			await new Promise((r) => setTimeout(r));
			expect(setups).toBe(before + 1);

			// An attribute change that leaves the tokens alone is ignored.
			document.documentElement.style.setProperty("overflow", "hidden");
			await new Promise((r) => setTimeout(r));
			expect(setups).toBe(before + 1);

			await unmount();
			document.documentElement.setAttribute("data-theme", "light");
			await new Promise((r) => setTimeout(r));
			expect(setups).toBe(before + 1);
		} finally {
			theme.remove();
			document.documentElement.removeAttribute("data-theme");
			document.documentElement.style.removeProperty("overflow");
		}
	});
});
