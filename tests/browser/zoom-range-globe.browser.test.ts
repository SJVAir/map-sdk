import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap, pointsPlugin } from "../../src/lib/index.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import { staticSource } from "../../src/lib/data/static-source.js";
import type { MapFeatureProperties } from "../../src/lib/data/types.js";
import { pm25Scale } from "../fixtures/scales.js";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

const style = { version: 8, sources: {}, layers: [] };
const center: [number, number] = [-119.8, 36.76];
const requests: string[] = [];
const EXPECTED_WARNINGS = [
	/^MapTiler Cloud API key is not set/,
	/^\[webglcontextlost\] .* harmless/
];
const warn = console.warn.bind(console);
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	if (!EXPECTED_WARNINGS.some((re) => re.test(args.map(String).join(" ")))) warn(...args);
});
const sized = document.createElement("style");
sized.textContent = ".globe-map { width: 600px; height: 400px; }";

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

function trackAttach(map: MapContext): GlMapLike[] {
	const attached: GlMapLike[] = [];
	const attach = map.attach.bind(map);
	vi.spyOn(map, "attach").mockImplementation((gl) => {
		attached.push(gl);
		attach(gl);
	});
	return attached;
}

/** One point at the center, drawn only within `zoomRange`. */
function plugin(id: string, zoomRange: { min?: number; max?: number }) {
	return pointsPlugin<MapFeatureProperties>({
		id,
		layerLabel: id,
		circle: { radius: 10 },
		zoomRange,
		source: staticSource(
			{
				type: "FeatureCollection",
				features: [
					{
						type: "Feature",
						geometry: { type: "Point", coordinates: center },
						properties: { refKey: `monitor:${id}`, name: id, value: 10 }
					}
				]
			},
			pm25Scale
		)
	});
}

describe("zoomRange on the globe", () => {
	// MapLibre's globe uses zoom-10 tiles a little before the camera reaches 10, and a layer
	// maxzoom drops a layer from those tiles: with layer zoom ranges, nothing drew here.
	it.each([9.97, 9.995, 10.01])(
		"two ranges meeting at 10 leave no gap at zoom %s",
		async (zoom) => {
			const map = createMap({
				config: {
					maptilerKey: "test-key",
					basemaps: { styles: [{ id: "a", style }], defaultId: "a" },
					projection: "globe",
					initialView: { center, zoom, bearing: 0, pitch: 0 }
				}
			});
			map.addPlugin(plugin("below", { max: 10 }));
			map.addPlugin(plugin("above", { min: 10 }));
			const attached = trackAttach(map);
			await render(MapView, { map, class: "globe-map" });
			const gl = attached[0] as GlMapLike & { isGlobeProjection(): boolean };
			await vi.waitFor(() => expect(map.ready).toBe(true), { timeout: 5000 });
			expect(gl.isGlobeProjection()).toBe(true);
			const { x, y } = gl.project(center);
			await vi.waitFor(() =>
				expect(map.featuresAt({ x, y }).map((h) => h.refKey)).toEqual([
					zoom < 10 ? "monitor:below" : "monitor:above"
				])
			);
		}
	);
});
