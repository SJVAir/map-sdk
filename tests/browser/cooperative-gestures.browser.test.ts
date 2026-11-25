import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap } from "../../src/lib/index.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

const style = { version: 8, sources: {}, layers: [] };
const requests: string[] = [];
const EXPECTED_WARNINGS = [/^MapTiler Cloud API key is not set/];
const warn = console.warn.bind(console);
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	if (!EXPECTED_WARNINGS.some((re) => re.test(args.map(String).join(" ")))) warn(...args);
});
const sized = document.createElement("style");
sized.textContent = ".coop-map { width: 600px; height: 400px; }";

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
});

afterAll(() => {
	expect(requests).toEqual([]);
});

async function mount(map: MapContext): Promise<GlMapLike> {
	let gl: GlMapLike | undefined;
	const attach = map.attach.bind(map);
	vi.spyOn(map, "attach").mockImplementation((g) => {
		gl = g;
		attach(g);
	});
	await render(MapView, { map, class: "coop-map" });
	await vi.waitFor(() => expect(map.ready).toBe(true), { timeout: 5000 });
	return gl!;
}

function newMap(cooperativeGestures: boolean) {
	return createMap({
		config: {
			maptilerKey: "test-key",
			basemaps: { styles: [{ id: "a", style }], defaultId: "a" },
			initialView: { center: [-119.8, 36.76], zoom: 7, bearing: 0, pitch: 0 },
			cooperativeGestures
		}
	});
}

const frame = () => new Promise((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A wheel over the map's middle: plain, or with Ctrl/⌘ (the bypass key). */
function sendWheel(gl: GlMapLike, bypass = false) {
	const canvas = gl.getCanvas();
	const rect = canvas.getBoundingClientRect();
	const mac = navigator.userAgent.includes("Mac");
	canvas.dispatchEvent(
		new WheelEvent("wheel", {
			bubbles: true,
			cancelable: true,
			deltaY: -200,
			deltaMode: WheelEvent.DOM_DELTA_PIXEL,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			ctrlKey: bypass && !mac,
			metaKey: bypass && mac
		})
	);
}

/** Sends a wheel and resolves with the zoom once MapLibre's ease has stopped. */
async function wheel(gl: GlMapLike, bypass = false): Promise<number> {
	sendWheel(gl, bypass);
	// MapLibre decides the wheel's type after 40 ms and eases for 200 ms after that.
	await wait(300);
	let last = NaN;
	let still = 0;
	while (still < 5) {
		await frame();
		const zoom = gl.getZoom();
		still = zoom === last ? still + 1 : 0;
		last = zoom;
	}
	return last;
}

const overlay = () => document.querySelector(".maplibregl-cooperative-gesture-screen");

describe("cooperative gestures", () => {
	it("a plain wheel doesn't zoom while on, and zooms once switched off", async () => {
		const map = newMap(true);
		const gl = await mount(map);
		expect(overlay()).not.toBeNull();
		expect(await wheel(gl)).toBe(7);

		map.setCooperativeGestures(false);
		expect(overlay()).toBeNull();
		expect(await wheel(gl)).toBeGreaterThan(7);

		map.setCooperativeGestures(true);
		const zoom = gl.getZoom();
		expect(overlay()).not.toBeNull();
		expect(await wheel(gl)).toBe(zoom);
	});

	it("a Ctrl/⌘ wheel still zooms while on", async () => {
		const gl = await mount(newMap(true));
		expect(await wheel(gl, true)).toBeGreaterThan(7);
	});

	it("switching off right after a blocked wheel raises no error", async () => {
		const map = newMap(true);
		const gl = await mount(map);
		const errors: unknown[] = [];
		const onError = (e: ErrorEvent) => {
			errors.push(e.error ?? e.message);
			e.preventDefault();
		};
		window.addEventListener("error", onError);
		try {
			// The engine blocks the wheel and starts its 100 ms hint timer during the dispatch.
			sendWheel(gl);
			map.setCooperativeGestures(false);
			await wait(300);
			expect(errors).toEqual([]);
			expect(overlay()).toBeNull();
			expect(await wheel(gl)).toBeGreaterThan(7);
		} finally {
			window.removeEventListener("error", onError);
		}
	});

	it("creates the map with a setting changed before it was created", async () => {
		const map = newMap(true);
		map.setCooperativeGestures(false);
		const gl = await mount(map);
		expect(overlay()).toBeNull();
		expect(await wheel(gl)).toBeGreaterThan(7);
	});
});
