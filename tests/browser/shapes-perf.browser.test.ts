import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap, shapesPlugin } from "../../src/lib/index.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import { staticSource } from "../../src/lib/data/static-source.js";
import type { MapFeatureProperties } from "../../src/lib/data/types.js";
import { inView } from "../../src/lib/ui/feature-list.js";
import { lensGrid } from "../fixtures/lens-grid.js";
import { pm25Scale } from "../fixtures/scales.js";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

// A measurement, not a check: run with MAPSDK_PERF=1. 2500 sections (the dashboard's worst case
// per view) as one shapes plugin; times what map-sdk does per move (features() and the in-view
// test the list and summary run).
const ORIGIN: [number, number] = [-120.3, 36.3];
const SIZE = 1 / 69; // about a mile, in degrees of latitude

const style = { version: 8, sources: {}, layers: [] };
const sized = document.createElement("style");
sized.textContent = ".perf-map { width: 1200px; height: 800px; }";
beforeAll(() => {
	maptilerConfig.telemetry = false;
	document.head.append(sized);
	vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("offline")));
});
afterAll(() => sized.remove());

describe.skipIf(!import.meta.env.VITE_MAPSDK_PERF)("2500 sections in view", () => {
	it("measures features() and inView per move", async () => {
		// 25×25 parents of 2×2 children = 2500 sections.
		const grid = lensGrid({ rows: 25, cols: 25, origin: ORIGIN, size: SIZE * 2 });
		expect(grid.children.features).toHaveLength(2500);
		const map = createMap({
			config: {
				maptilerKey: "test-key",
				basemaps: { styles: [{ id: "a", style }], defaultId: "a" },
				initialView: {
					center: [ORIGIN[0] + 25 * SIZE, ORIGIN[1] + 25 * SIZE],
					zoom: 9.5,
					bearing: 0,
					pitch: 0
				}
			}
		});
		const plugin = shapesPlugin<MapFeatureProperties>({
			id: "sections",
			source: staticSource(grid.children, pm25Scale),
			layerLabel: "Sections",
			mode: "choropleth"
		});
		map.addPlugin(plugin);
		const attached: GlMapLike[] = [];
		const attach = map.attach.bind(map);
		vi.spyOn(map, "attach").mockImplementation((gl) => {
			attached.push(gl);
			attach(gl);
		});
		render(MapView, { map, class: "perf-map" });
		await vi.waitFor(() => expect(map.ready).toBe(true), { timeout: 10000 });
		const gl = attached[0];
		const times: number[] = [];
		for (let i = 0; i < 20; i++) {
			gl.jumpTo({ center: [ORIGIN[0] + (20 + i) * SIZE, ORIGIN[1] + (20 + (i % 5)) * SIZE] });
			const b = gl.getBounds();
			const bounds = {
				west: b.getWest(),
				south: b.getSouth(),
				east: b.getEast(),
				north: b.getNorth()
			};
			const t0 = performance.now();
			inView(plugin.features!(), bounds);
			times.push(performance.now() - t0);
		}
		times.sort((a, b) => a - b);
		const median = times[10];
		const max = times[times.length - 1];
		// Reported through the failure message: browser specs don't show console output.
		throw new Error(`MAPSDK_PERF median ${median.toFixed(2)} ms, max ${max.toFixed(2)} ms`);
	});
});
