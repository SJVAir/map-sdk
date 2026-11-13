import { flushSync } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { BasemapState, type BasemapConfig } from "../../../src/lib/core/basemap.svelte.js";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import type { MapPlugin } from "../../../src/lib/core/plugin.js";
import type { MapFeatureProperties } from "../../../src/lib/data/types.js";
import { shapesPlugin } from "../../../src/lib/plugins/shapes.svelte.js";
import { rootEffect } from "../../fixtures/effects.svelte.js";
import { createFakeGl } from "../../fixtures/fake-gl.js";
import { smokeScale } from "../../fixtures/scales.js";
import { TestSource } from "../../fixtures/sources.svelte.js";

const url = (id: string) => `https://tiles.test/maps/${id}/style.json`;
const config: BasemapConfig = {
	styles: [
		{ id: "streets", style: url("streets") },
		{ id: "dark", style: url("dark") },
		{ id: "pastel", style: url("pastel") },
		{ id: "inline", style: { version: 8, sources: {}, layers: [] } }
	],
	defaultId: "streets",
	excludedLayers: ["Sport", "Food"]
};
const failure = (id: string) => ({ error: { url: `${url(id)}?key=abc` } });

function setup() {
	const gl = createFakeGl({ styleLoaded: true });
	const basemap = new BasemapState(config);
	const ready = vi.fn();
	basemap.attach(gl, ready);
	const setStyle = vi.spyOn(gl, "setStyle");
	return { gl, basemap, ready, setStyle };
}

describe("BasemapState", () => {
	it("starts on the default and does not set a style on attach", () => {
		const { basemap, setStyle, ready } = setup();
		expect(basemap.current).toBe("streets");
		expect(setStyle).not.toHaveBeenCalled();
		expect(ready).not.toHaveBeenCalled();
	});

	it("select sets the style once and announces it when it loads", () => {
		const { gl, basemap, setStyle, ready } = setup();
		basemap.select("dark");
		expect(basemap.current).toBe("dark");
		expect(setStyle).toHaveBeenCalledTimes(1);
		expect(setStyle).toHaveBeenCalledWith(url("dark"), { diff: false });
		expect(ready).not.toHaveBeenCalled();
		gl.fireStyleLoad();
		expect(ready).toHaveBeenCalledTimes(1);
		expect(gl.listeners.filter((l) => l.type === "error" || l.type === "style.load")).toEqual([]);
	});

	it("does not reload the applied basemap", () => {
		const { basemap, setStyle } = setup();
		basemap.select("streets");
		expect(setStyle).not.toHaveBeenCalled();
		expect(basemap.current).toBe("streets");
	});

	it("lets a newer select supersede one still loading", () => {
		const { gl, basemap, setStyle, ready } = setup();
		basemap.select("dark");
		basemap.select("pastel");
		expect(setStyle.mock.calls.map(([style]) => style)).toEqual([url("dark"), url("pastel")]);
		// The superseded style failing is not heard.
		gl.emit("error", failure("dark"));
		expect(setStyle).toHaveBeenCalledTimes(2);
		expect(basemap.current).toBe("pastel");
		gl.fireStyleLoad();
		expect(ready).toHaveBeenCalledTimes(1);
	});

	it("reverts to the last loaded style when the requested one fails", () => {
		const { gl, basemap, setStyle, ready } = setup();
		basemap.select("dark");
		gl.fireStyleLoad();
		basemap.select("pastel");
		gl.emit("error", failure("pastel"));
		expect(setStyle).toHaveBeenLastCalledWith(url("dark"), { diff: false });
		expect(basemap.current).toBe("dark");
		expect(ready).toHaveBeenCalledTimes(1);
		gl.fireStyleLoad();
		expect(ready).toHaveBeenCalledTimes(2);
	});

	it("stays unstyled when the fallback fails too, until the next select", () => {
		const { gl, basemap, setStyle, ready } = setup();
		basemap.select("dark");
		gl.emit("error", failure("dark"));
		gl.emit("error", failure("streets"));
		expect(setStyle.mock.calls.map(([style]) => style)).toEqual([url("dark"), url("streets")]);
		expect(gl.listeners.filter((l) => l.type === "error")).toEqual([]);
		expect(ready).not.toHaveBeenCalled();
		basemap.select("streets");
		expect(setStyle).toHaveBeenCalledTimes(3);
		gl.fireStyleLoad();
		expect(ready).toHaveBeenCalledTimes(1);
	});

	it("ignores errors for tiles and other requests", () => {
		const { gl, basemap, setStyle } = setup();
		basemap.select("dark");
		gl.emit("error", { error: { url: "https://tiles.test/tiles/7/21/49.pbf?key=abc" } });
		gl.emit("error", { error: new Error("sprite") });
		gl.emit("error", {});
		gl.emit("error", failure("pastel"));
		expect(setStyle).toHaveBeenCalledTimes(1);
		expect(basemap.current).toBe("dark");
	});

	it("cannot match errors to a style given as an object", () => {
		const { gl, basemap, setStyle } = setup();
		basemap.select("inline");
		gl.emit("error", { error: { url: url("inline") } });
		gl.emit("error", { error: new Error("unknown") });
		expect(setStyle).toHaveBeenCalledTimes(1);
		expect(basemap.current).toBe("inline");
		gl.fireStyleLoad();
		expect(basemap.current).toBe("inline");
	});

	it("removes excluded layers after a style loads, and from the first style", () => {
		const gl = createFakeGl({ styleLoaded: false });
		const basemap = new BasemapState(config);
		const ready = vi.fn();
		basemap.attach(gl, ready);
		const layer = (id: string) => ({ id, type: "background" as const });
		gl.styleLoaded = true;
		gl.layers.push(layer("Sport"), layer("Roads"), layer("Food"));
		gl.emit("style.load");
		expect(gl.layers.map((l) => l.id)).toEqual(["Roads"]);
		expect(ready).not.toHaveBeenCalled();

		basemap.select("dark");
		gl.setStyle(null);
		gl.styleLoaded = true;
		gl.layers.push(layer("Food"), layer("Water"));
		gl.emit("style.load");
		expect(gl.layers.map((l) => l.id)).toEqual(["Water"]);
		expect(ready).toHaveBeenCalledTimes(1);
	});

	it("select while detached only changes current; attach does not announce", () => {
		const gl = createFakeGl({ styleLoaded: true });
		const basemap = new BasemapState(config);
		basemap.select("dark");
		const ready = vi.fn();
		basemap.attach(gl, ready);
		const setStyle = vi.spyOn(gl, "setStyle");
		basemap.select("dark");
		expect(setStyle).not.toHaveBeenCalled();
		expect(ready).not.toHaveBeenCalled();
	});

	it("detach cancels a pending load", () => {
		const { gl, basemap, ready } = setup();
		basemap.select("dark");
		basemap.detach();
		expect(gl.listeners).toEqual([]);
		gl.fireStyleLoad();
		expect(ready).not.toHaveBeenCalled();
		basemap.select("pastel");
		expect(basemap.current).toBe("pastel");
	});

	it("attach in an effect does not depend on current", () => {
		const gl = createFakeGl({ styleLoaded: true });
		const basemap = new BasemapState(config);
		let runs = 0;
		const stop = rootEffect(() => {
			runs++;
			basemap.attach(gl, () => {});
		});
		flushSync();
		basemap.select("dark");
		flushSync();
		basemap.select("pastel");
		flushSync();
		expect(runs).toBe(1);
		stop();
	});
});

describe("BasemapState with the plugin host", () => {
	function plugin(setupFn: () => void): MapPlugin {
		return { id: "p", setup: () => (setupFn(), () => {}) } as unknown as MapPlugin;
	}

	it("sets each plugin up once after attach and the first style.load, again after a switch", () => {
		const map = createMap({ config: { maptilerKey: "k", basemaps: config } });
		const setupFn = vi.fn();
		map.addPlugin(plugin(setupFn));
		const gl = createFakeGl({ styleLoaded: false });
		map.attach(gl);
		expect(setupFn).not.toHaveBeenCalled();
		gl.fireStyleLoad();
		expect(setupFn).toHaveBeenCalledTimes(1);

		map.basemap.select("dark");
		gl.fireStyleLoad();
		expect(setupFn).toHaveBeenCalledTimes(2);
		map.destroy();
	});

	it("sets plugins up on the new style's style.load while its tiles still load", () => {
		const map = createMap({ config: { maptilerKey: "k", basemaps: config } });
		const setupFn = vi.fn();
		map.addPlugin(plugin(setupFn));
		const gl = createFakeGl({ styleLoaded: false });
		map.attach(gl);
		gl.fireStyleLoad();
		expect(setupFn).toHaveBeenCalledTimes(1);

		map.basemap.select("dark");
		gl.tilesLoading = true;
		gl.fireStyleLoad();
		// No wait for idle: the style is loaded, only its tiles are pending.
		expect(setupFn).toHaveBeenCalledTimes(2);
		expect(gl.listeners.filter((l) => l.type === "idle")).toEqual([]);
		gl.tilesLoading = false;
		gl.emit("idle");
		expect(setupFn).toHaveBeenCalledTimes(2);
		map.destroy();
	});

	it("sets plugins up on the first style.load while its tiles still load", () => {
		const map = createMap({ config: { maptilerKey: "k", basemaps: config } });
		const setupFn = vi.fn();
		map.addPlugin(plugin(setupFn));
		const gl = createFakeGl({ styleLoaded: false });
		map.attach(gl);
		gl.tilesLoading = true;
		gl.fireStyleLoad();
		expect(setupFn).toHaveBeenCalledTimes(1);
		map.destroy();
	});

	it("sets plugins up at once on a theme change while tiles load", () => {
		const map = createMap({ config: { maptilerKey: "k", basemaps: config } });
		const setupFn = vi.fn();
		map.addPlugin(plugin(setupFn));
		const gl = createFakeGl({ styleLoaded: false });
		map.attach(gl);
		gl.fireStyleLoad();
		gl.tilesLoading = true;
		map.themeChanged();
		expect(setupFn).toHaveBeenCalledTimes(2);
		map.destroy();
	});

	it("a theme change during a basemap switch waits for the new style", () => {
		const map = createMap({ config: { maptilerKey: "k", basemaps: config } });
		const setupFn = vi.fn();
		map.addPlugin(plugin(setupFn));
		const gl = createFakeGl({ styleLoaded: false });
		map.attach(gl);
		gl.fireStyleLoad();
		map.basemap.select("dark");
		map.themeChanged();
		expect(setupFn).toHaveBeenCalledTimes(1);
		gl.tilesLoading = true;
		gl.fireStyleLoad();
		expect(setupFn).toHaveBeenCalledTimes(2);
		map.destroy();
	});

	it("tears plugins down before the new style loads, so data and selection changes wait", async () => {
		type Props = MapFeatureProperties;
		const square = (x: number): number[][] => [
			[x, 0],
			[x + 1, 0],
			[x + 1, 1],
			[x, 0]
		];
		const shapes = (keys: string[]) => ({
			type: "FeatureCollection" as const,
			features: keys.map((k, i) => ({
				type: "Feature" as const,
				geometry: { type: "Polygon" as const, coordinates: [square(i * 2)] },
				properties: { refKey: `region:${k}`, name: k, value: 1 } as Props
			}))
		});
		const source = new TestSource<Props>({ features: shapes(["a", "b"]), scale: smokeScale });
		const map = createMap({ config: { maptilerKey: "k", basemaps: config } });
		map.addPlugin(
			shapesPlugin<Props>({
				id: "shp",
				source,
				layerLabel: "Smoke",
				mode: "choropleth",
				selectable: true
			}),
			{ selectionMode: "single" }
		);
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		const settle = async () => {
			await Promise.resolve();
			await Promise.resolve();
			flushSync();
		};
		await settle();
		map.setSelection("shp", { kind: "regions", ids: ["b"] });
		flushSync();
		expect(gl.featureStates.get(`${map.uid}:shp:shapes/region:b`)).toEqual({ selected: true });

		map.basemap.select("dark");
		const from = gl.calls.length;
		source.features = shapes(["a", "b", "c"]);
		map.setSelection("shp", { kind: "regions", ids: ["a"] });
		await settle();
		const touched = gl.calls
			.slice(from)
			.filter((c) => /^(getSource|setData|setFeatureState|removeFeatureState|addLayer)/.test(c));
		expect(touched).toEqual([]);

		gl.fireStyleLoad();
		await settle();
		expect(gl.layers.map((l) => l.id)).toContain(`${map.uid}:shp:fill`);
		const data = gl.sources.get(`${map.uid}:shp:shapes`) as { data: { features: unknown[] } };
		expect(data.data.features).toHaveLength(3);
		expect(gl.featureStates.get(`${map.uid}:shp:shapes/region:a`)).toEqual({ selected: true });
		map.destroy();
	});
});

describe("BasemapState: named basemaps, resolution, and fallback reports", () => {
	const named: BasemapConfig = {
		styles: [
			{
				id: "streets-v4",
				style: url("streets-v4"),
				basemap: "Streets",
				name: "Default",
				isDefault: true
			},
			{ id: "streets-v4-dark", style: url("streets-v4-dark"), basemap: "Streets", name: "Dark" },
			{
				id: "outdoor-v2",
				style: url("outdoor-v2"),
				basemap: "Outdoor",
				name: "Default",
				isDefault: true
			},
			{ id: "outdoor-v2-dark", style: url("outdoor-v2-dark"), basemap: "Outdoor", name: "Dark" }
		],
		defaultId: "streets-v4"
	};

	function namedSetup() {
		const gl = createFakeGl({ styleLoaded: true });
		const basemap = new BasemapState(named);
		basemap.attach(gl, vi.fn());
		const setStyle = vi.spyOn(gl, "setStyle");
		const reports = vi.fn();
		basemap.onFallback(reports);
		return { gl, basemap, setStyle, reports };
	}

	it("lists its styles", () => {
		const { basemap } = namedSetup();
		expect(basemap.styles.map((s) => s.id)).toEqual(named.styles.map((s) => s.id));
	});

	it("resolves an unlisted id of a listed basemap to its default variant and reports it", () => {
		const { basemap, reports } = namedSetup();
		expect(basemap.resolve("outdoor-v1-dark")).toBe("outdoor-v2");
		basemap.select("outdoor-v1-dark");
		expect(basemap.current).toBe("outdoor-v2");
		expect(reports).toHaveBeenCalledTimes(1);
		expect(reports).toHaveBeenCalledWith("outdoor-v2");
	});

	it("resolves an id of no listed basemap to the default", () => {
		const { basemap, reports } = namedSetup();
		basemap.select("outdoor-v2-dark");
		reports.mockClear();
		expect(basemap.resolve("nope")).toBe("streets-v4");
		basemap.select("nope");
		expect(basemap.current).toBe("streets-v4");
		expect(reports).toHaveBeenCalledOnce();
		expect(reports).toHaveBeenCalledWith("streets-v4");
	});

	it("a listed id never reports", () => {
		const { basemap, reports } = namedSetup();
		expect(basemap.resolve("outdoor-v2-dark")).toBe("outdoor-v2-dark");
		basemap.select("outdoor-v2-dark");
		expect(reports).not.toHaveBeenCalled();
	});

	it("reports a load failure's revert once", () => {
		const { gl, basemap, reports } = namedSetup();
		basemap.select("outdoor-v2");
		gl.emit("error", { error: { url: url("outdoor-v2") } });
		expect(basemap.current).toBe("streets-v4");
		expect(reports).toHaveBeenCalledOnce();
		expect(reports).toHaveBeenCalledWith("streets-v4");
	});

	it("a handler that throws doesn't stop the others", () => {
		const { basemap, reports } = namedSetup();
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		basemap.onFallback(() => {
			throw new Error("boom");
		});
		const after = vi.fn();
		basemap.onFallback(after);
		basemap.select("nope");
		expect(reports).toHaveBeenCalledOnce();
		expect(after).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it("onFallback's unsubscribe stops reports", () => {
		const gl = createFakeGl({ styleLoaded: true });
		const basemap = new BasemapState(named);
		basemap.attach(gl, vi.fn());
		const reports = vi.fn();
		const stop = basemap.onFallback(reports);
		stop();
		basemap.select("nope");
		expect(reports).not.toHaveBeenCalled();
	});

	it("removes a style's own excludedLayers, else the config's", () => {
		const gl = createFakeGl({ styleLoaded: true });
		const basemap = new BasemapState({
			styles: [
				{ id: "a", style: url("a"), excludedLayers: ["Food"] },
				{ id: "b", style: url("b") }
			],
			defaultId: "a",
			excludedLayers: ["Water"]
		});
		const layer = (id: string) => ({ id, type: "background" as const });
		gl.layers.push(layer("Food"), layer("Water"));
		basemap.attach(gl, vi.fn());
		expect(gl.layers.map((l) => l.id)).toEqual(["Water"]);
		basemap.select("b");
		gl.setStyle(null);
		gl.styleLoaded = true;
		gl.layers.push(layer("Food"), layer("Water"));
		gl.emit("style.load");
		expect(gl.layers.map((l) => l.id)).toEqual(["Food"]);
	});
});
