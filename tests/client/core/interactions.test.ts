import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, tick } from "svelte";
import { createMap, type MapContext } from "../../../src/lib/core/create-map.svelte.js";
import { InteractionRouter } from "../../../src/lib/core/interactions.svelte.js";
import type { FeatureListItem, MapPlugin } from "../../../src/lib/core/plugin.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";
import { rootEffect } from "../../fixtures/effects.svelte.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";

const config = { maptilerKey: "test-key" };

/** A plugin with one interactive circle layer whose features carry `{ id, name }`. */
function points(id: string, kind: "monitor" | "region" = "monitor"): MapPlugin {
	return {
		id,
		setup(ctx) {
			const source = ctx.addSource("src", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			const layer = ctx.addLayer("points", { type: "circle", source });
			ctx.interactive([layer], (props) => {
				const fid = String(props.id);
				if (kind === "monitor") {
					return {
						pluginId: id,
						ref: { kind: "monitor", id: fid },
						refKey: `monitor:${fid}`,
						name: String(props.name)
					};
				}
				return {
					pluginId: id,
					ref: { kind: "region", type: "county", code: fid },
					refKey: `region:county:${fid}`,
					name: String(props.name)
				};
			});
			return () => {};
		}
	};
}

/** A rendered feature on `pluginId`'s points layer of `map`. */
function rendered(map: MapContext, pluginId: string, id: string, name = `Site ${id}`) {
	const layer = `${map.uid}:${pluginId}:points`;
	return {
		layer: { id: layer },
		source: `${map.uid}:${pluginId}:src`,
		properties: { id, name },
		geometry: { type: "Point" as const, coordinates: [-119, 36] }
	};
}

function click(gl: FakeGl, originalEvent: Record<string, unknown> = {}) {
	gl.emit("click", { point: { x: 10, y: 20 }, lngLat: { lng: -119, lat: 36 }, originalEvent });
}

async function setUp(mode: "none" | "single" | "multiple", selection = null as null | string[]) {
	const map = createMap({ config });
	const onselectionchange = vi.fn();
	map.addPlugin(points("monitors"), {
		selectionMode: mode,
		selection: selection && { kind: "monitors", ids: selection },
		onselectionchange
	});
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	await tick();
	return { map, gl, onselectionchange };
}

const stops: Array<() => void> = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

describe("picking", () => {
	it("reports a click on a feature as featureclick with its plugin and ref", async () => {
		const { map, gl } = await setUp("none");
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "monitors", "7")]);
		click(gl);
		expect(handler).toHaveBeenCalledExactlyOnceWith({
			pluginId: "monitors",
			ref: { kind: "monitor", id: "7" },
			lngLat: [-119, 36]
		});
		expect(map.getSelection("monitors")).toBeNull();
	});

	it("adds the plugin's properties for the clicked feature to featureclick", async () => {
		const map = createMap({ config });
		const lookup = vi.fn((refKey: string) =>
			refKey === "monitor:7" ? { refKey, external_id: "X7" } : undefined
		);
		map.addPlugin({ ...points("monitors"), properties: lookup });
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "monitors", "7")]);
		click(gl);
		expect(handler).toHaveBeenCalledExactlyOnceWith({
			pluginId: "monitors",
			ref: { kind: "monitor", id: "7" },
			lngLat: [-119, 36],
			properties: { refKey: "monitor:7", external_id: "X7" }
		});
		expect(lookup).toHaveBeenCalledWith("monitor:7");
	});

	it("gives each featureclick handler its own event", async () => {
		const { map, gl } = await setUp("none");
		const seen: unknown[] = [];
		map.on("featureclick", (e) => {
			delete (e as { ref?: unknown }).ref;
		});
		map.on("featureclick", (e) => seen.push(e.ref));
		gl.setRenderedFeatures([rendered(map, "monitors", "7")]);
		click(gl);
		expect(seen).toEqual([{ kind: "monitor", id: "7" }]);
	});

	it("replaces the selection on a plain click", async () => {
		const { map, gl, onselectionchange } = await setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
		expect(onselectionchange).toHaveBeenCalledExactlyOnceWith({ kind: "monitors", ids: ["2"] });
	});

	it("toggles with shift, meta, or ctrl in multiple mode", async () => {
		const { map, gl, onselectionchange } = await setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, { shiftKey: true });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });
		click(gl, { metaKey: true });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
		click(gl, { ctrlKey: true });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });
		expect(onselectionchange).toHaveBeenCalledTimes(3);
	});

	it("toggles on a touch tap in multiple mode", async () => {
		const { map, gl } = await setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, { pointerType: "touch" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });
		gl.setRenderedFeatures([rendered(map, "monitors", "1")]);
		click(gl, { pointerType: "touch" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("treats a MouseEvent click after a touch pointerdown as a touch tap", async () => {
		// Safari before 17 dispatches click as a MouseEvent, with no pointerType.
		const { map, gl } = await setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		gl.canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
		click(gl, {});
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });

		// Cleared after each click: a later plain click replaces.
		click(gl, {});
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("lets the click's own pointerType win over the recorded one", async () => {
		const { map, gl } = await setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		gl.canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
		click(gl, { pointerType: "mouse" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("stops recording pointerdown after detach", async () => {
		const { map, gl } = await setUp("multiple", ["1"]);
		map.detach();
		gl.canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
		map.attach(gl);
		await tick();
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, {});
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("replaces on shift-click and touch in single mode", async () => {
		const { map, gl } = await setUp("single", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, { shiftKey: true });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		click(gl, { pointerType: "touch" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["3"] });
	});

	it("keeps host ids that are not in the data when toggling", async () => {
		const { map, gl, onselectionchange } = await setUp("multiple", ["999", "1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, { shiftKey: true });
		expect(onselectionchange).toHaveBeenCalledExactlyOnceWith({
			kind: "monitors",
			ids: ["999", "1", "2"]
		});
	});

	it("does not call onselectionchange when the pick changes nothing", async () => {
		const { map, gl, onselectionchange } = await setUp("single", ["2"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
		expect(onselectionchange).not.toHaveBeenCalled();
	});

	it("does nothing on a click with no hits", async () => {
		const { map, gl, onselectionchange } = await setUp("multiple", ["1"]);
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([]);
		click(gl);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
		expect(handler).not.toHaveBeenCalled();
		expect(onselectionchange).not.toHaveBeenCalled();
	});

	it("picks only the top hit, for its own plugin", async () => {
		const map = createMap({ config });
		const onMonitors = vi.fn();
		const onRegions = vi.fn();
		map.addPlugin(points("monitors"), { selectionMode: "single", onselectionchange: onMonitors });
		await tick();
		map.addPlugin(points("regions", "region"), {
			selectionMode: "single",
			onselectionchange: onRegions
		});
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		gl.setRenderedFeatures([rendered(map, "regions", "019"), rendered(map, "monitors", "1")]);
		click(gl);
		expect(map.getSelection("regions")).toEqual({ kind: "regions", ids: ["county:019"] });
		expect(onRegions).toHaveBeenCalledOnce();
		expect(map.getSelection("monitors")).toBeNull();
		expect(onMonitors).not.toHaveBeenCalled();
	});

	it("keeps two maps apart", async () => {
		const a = await setUp("multiple");
		const b = await setUp("multiple");
		const handlerB = vi.fn();
		b.map.on("featureclick", handlerB);
		a.gl.setRenderedFeatures([rendered(a.map, "monitors", "1")]);
		b.gl.setRenderedFeatures([]);
		click(a.gl);
		expect(a.map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
		expect(b.map.getSelection("monitors")).toBeNull();
		expect(handlerB).not.toHaveBeenCalled();
		expect(b.onselectionchange).not.toHaveBeenCalled();
	});

	it("stops reporting clicks after destroy", async () => {
		const { map, gl, onselectionchange } = await setUp("multiple");
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "monitors", "1")]);
		map.destroy();
		click(gl);
		expect(handler).not.toHaveBeenCalled();
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(gl.listeners.filter((l) => l.type === "click")).toEqual([]);
	});

	it("stops reporting clicks after detach and resumes on attach", async () => {
		const { map, gl } = await setUp("multiple");
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "monitors", "1")]);
		map.detach();
		click(gl);
		expect(handler).not.toHaveBeenCalled();
		const next = createFakeGl({ styleLoaded: true });
		map.attach(next);
		await tick();
		next.setRenderedFeatures([rendered(map, "monitors", "1")]);
		click(next);
		expect(handler).toHaveBeenCalledOnce();
	});
});

describe("featuresAt", () => {
	it("returns hits from two plugins, topmost first, de-duplicated", async () => {
		const map = createMap({ config });
		map.addPlugin(points("monitors"));
		await tick();
		map.addPlugin(points("regions", "region"));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		gl.setRenderedFeatures([
			rendered(map, "regions", "019", "Fresno"),
			rendered(map, "monitors", "1", "Site 1"),
			rendered(map, "monitors", "1", "Site 1")
		]);
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([
			{
				pluginId: "regions",
				ref: { kind: "region", type: "county", code: "019" },
				refKey: "region:county:019",
				name: "Fresno"
			},
			{
				pluginId: "monitors",
				ref: { kind: "monitor", id: "1" },
				refKey: "monitor:1",
				name: "Site 1"
			}
		]);
	});

	it("skips features whose toHit returns null, and layers nobody registered", async () => {
		const router = new InteractionRouter();
		const gl = createFakeGl({ styleLoaded: true });
		gl.addSource("s", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
		gl.addLayer({ id: "a", type: "circle", source: "s" });
		gl.addLayer({ id: "other", type: "circle", source: "s" });
		router.register("p", ["a"], (props) =>
			props.id === "skip"
				? null
				: { pluginId: "p", ref: { kind: "feature", id: "x" }, refKey: "feature:x", name: "X" }
		);
		router.attach(gl);
		await tick();
		const feature = (layer: string, id: string) => ({
			layer: { id: layer },
			source: "s",
			properties: { id },
			geometry: { type: "Point" as const, coordinates: [0, 0] }
		});
		gl.setRenderedFeatures([feature("other", "1"), feature("a", "skip"), feature("a", "2")]);
		expect(router.hitsAt([0, 0]).map((h) => h.refKey)).toEqual(["feature:x"]);
	});

	it("returns no hits while detached or when no layer is registered", async () => {
		const map = createMap({ config });
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([]);
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([]);
		expect(gl.calls).not.toContain("queryRenderedFeatures");
	});
});

describe("hover", () => {
	it("sets hovered on mousemove over a registered layer and clears it on mouseout", async () => {
		const { map, gl } = await setUp("none");
		const seen: Array<string | null> = [];
		stops.push(rootEffect(() => void seen.push(map.hovered?.hit.refKey ?? null)));
		flushSync();

		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		flushSync();
		expect(map.hovered).toEqual({
			hit: {
				pluginId: "monitors",
				ref: { kind: "monitor", id: "3" },
				refKey: "monitor:3",
				name: "Site 3"
			},
			lngLat: [-119.5, 36.5]
		});

		gl.emit("mouseout", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		flushSync();
		expect(map.hovered).toBeNull();
		expect(seen).toEqual([null, "monitor:3", null]);
	});

	it("clears hovered on mousemove off every registered layer", async () => {
		const { map, gl } = await setUp("none");
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered?.hit.refKey).toBe("monitor:3");
		gl.setRenderedFeatures([]);
		gl.emit("mousemove", { point: { x: 5, y: 5 }, lngLat: { lng: -119, lat: 36 } });
		expect(map.hovered).toBeNull();
	});

	it("clears hovered on detach and when the hovered plugin is removed", async () => {
		const { map, gl } = await setUp("none");
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		map.removePlugin("monitors");
		expect(map.hovered).toBeNull();

		map.addPlugin(points("monitors"));
		await tick();
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered?.hit.refKey).toBe("monitor:3");
		map.detach();
		expect(map.hovered).toBeNull();
	});
});

describe("blocking layers", () => {
	/** Clicks the bubbles' plugin got, by cluster id. */
	const bubbleClicks: unknown[] = [];

	/** A plugin with a blocking `bubbles` layer; hovering a bubble yields `toHover`'s hit. */
	function bubbles(id: string, hover: boolean): MapPlugin {
		return {
			id,
			setup(ctx) {
				const source = ctx.addSource("src", {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] }
				});
				const layer = ctx.addLayer("bubbles", { type: "circle", source });
				ctx.blocking(
					[layer],
					hover
						? (props) => ({
								pluginId: id,
								ref: { kind: "feature", id: `cluster:${String(props.cluster_id)}` },
								refKey: `feature:cluster:${String(props.cluster_id)}`,
								name: ""
							})
						: undefined,
					(feature) => bubbleClicks.push(feature.properties.cluster_id)
				);
				return () => {};
			}
		};
	}

	function bubble(map: MapContext, pluginId: string, clusterId: number) {
		return {
			layer: { id: `${map.uid}:${pluginId}:bubbles` },
			source: `${map.uid}:${pluginId}:src`,
			properties: { cluster_id: clusterId },
			geometry: { type: "Point" as const, coordinates: [-119, 36] }
		};
	}

	async function blockingSetUp(hover = true) {
		const map = createMap({ config });
		const onselectionchange = vi.fn();
		map.addPlugin(points("regions", "region"), { selectionMode: "single", onselectionchange });
		map.addPlugin(bubbles("clusters", hover));
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		return { map, gl, onselectionchange };
	}

	it("picks nothing beneath a blocking layer that is topmost, and tells the layer", async () => {
		bubbleClicks.length = 0;
		const { map, gl, onselectionchange } = await blockingSetUp();
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([bubble(map, "clusters", 7), rendered(map, "regions", "019", "Fresno")]);
		click(gl);
		expect(handler).not.toHaveBeenCalled();
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([]);
		expect(bubbleClicks).toEqual([7]);
	});

	it("picks a feature drawn above a blocking layer, without telling the layer", async () => {
		bubbleClicks.length = 0;
		const { map, gl } = await blockingSetUp();
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "regions", "019", "Fresno"), bubble(map, "clusters", 7)]);
		click(gl);
		expect(handler).toHaveBeenCalledWith({
			pluginId: "regions",
			ref: { kind: "region", type: "county", code: "019" },
			lngLat: [-119, 36]
		});
		expect(bubbleClicks).toEqual([]);
	});

	it("doesn't tell the layer on hover or lookups", async () => {
		bubbleClicks.length = 0;
		const { map, gl } = await blockingSetUp();
		gl.setRenderedFeatures([bubble(map, "clusters", 7)]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		map.featuresAt({ x: 1, y: 2 });
		expect(bubbleClicks).toEqual([]);
	});

	it("hovers the blocking layer's own hit instead of the feature beneath", async () => {
		const { map, gl } = await blockingSetUp();
		gl.setRenderedFeatures([bubble(map, "clusters", 7), rendered(map, "regions", "019", "Fresno")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered).toEqual({
			hit: {
				pluginId: "clusters",
				ref: { kind: "feature", id: "cluster:7" },
				refKey: "feature:cluster:7",
				name: ""
			},
			lngLat: [-119.5, 36.5]
		});
	});

	it("hovers nothing over a blocking layer without a hover hit", async () => {
		const { map, gl } = await blockingSetUp(false);
		gl.setRenderedFeatures([bubble(map, "clusters", 7), rendered(map, "regions", "019", "Fresno")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered).toBeNull();
	});

	it("hovers a higher-priority feature beneath a blocking layer, but the click stays blocked", async () => {
		bubbleClicks.length = 0;
		const map = createMap({ config });
		map.addPlugin({ ...points("regions", "region"), hoverPriority: 10 });
		await tick();
		map.addPlugin(bubbles("clusters", true));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([bubble(map, "clusters", 7), rendered(map, "regions", "019", "Fresno")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered?.hit.refKey).toBe("region:county:019");
		click(gl);
		expect(handler).not.toHaveBeenCalled();
		expect(bubbleClicks).toEqual([7]);
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([]);
	});

	it("keeps the blocking layer's hover over a feature of equal priority beneath", async () => {
		const map = createMap({ config });
		map.addPlugin({ ...points("regions", "region"), hoverPriority: 3 });
		await tick();
		map.addPlugin({ ...bubbles("clusters", true), hoverPriority: 3 });
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		gl.setRenderedFeatures([bubble(map, "clusters", 7), rendered(map, "regions", "019", "Fresno")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered?.hit.refKey).toBe("feature:cluster:7");
	});

	it("stops blocking once the plugin is removed", async () => {
		const { map, gl } = await blockingSetUp();
		gl.setRenderedFeatures([bubble(map, "clusters", 7), rendered(map, "regions", "019", "Fresno")]);
		map.removePlugin("clusters");
		expect(map.featuresAt({ x: 1, y: 2 }).map((h) => h.refKey)).toEqual(["region:county:019"]);
	});
});

describe("hover priority and cursor", () => {
	const move = (gl: FakeGl) =>
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });

	async function twoPlugins(lowPriority = 0, highPriority = 5) {
		const map = createMap({ config });
		map.addPlugin({ ...points("low"), hoverPriority: lowPriority });
		map.addPlugin({ ...points("high", "region"), hoverPriority: highPriority });
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		return { map, gl };
	}

	it("hover prefers the higher-priority plugin under a lower-drawn feature", async () => {
		const { map, gl } = await twoPlugins();
		// "low" is topmost (first), "high" beneath it.
		gl.setRenderedFeatures([rendered(map, "low", "1"), rendered(map, "high", "2")]);
		move(gl);
		expect(map.hovered?.hit.pluginId).toBe("high");
	});

	it("equal priority keeps topmost", async () => {
		const { map, gl } = await twoPlugins(3, 3);
		gl.setRenderedFeatures([rendered(map, "low", "1"), rendered(map, "high", "2")]);
		move(gl);
		expect(map.hovered?.hit.pluginId).toBe("low");
	});

	it("click ignores priority", async () => {
		const { map, gl } = await twoPlugins();
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "low", "1"), rendered(map, "high", "2")]);
		click(gl);
		expect(handler).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pluginId: "low" }));
	});

	it("a higher priority beneath a blocking bubble takes the hover", async () => {
		const map = createMap({ config });
		map.addPlugin({
			id: "clusters",
			setup(ctx) {
				const source = ctx.addSource("src", {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] }
				});
				ctx.blocking([ctx.addLayer("bubbles", { type: "circle", source })]);
				return () => {};
			}
		});
		await tick();
		map.addPlugin({ ...points("high"), hoverPriority: 9 });
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		gl.setRenderedFeatures([
			{
				layer: { id: `${map.uid}:clusters:bubbles` },
				source: `${map.uid}:clusters:src`,
				properties: {},
				geometry: { type: "Point", coordinates: [-119, 36] }
			},
			rendered(map, "high", "2")
		]);
		move(gl);
		expect(map.hovered?.hit.refKey).toBe("monitor:2");
		expect(gl.canvas.style.cursor).toBe("pointer");
	});

	it("cursor is pointer over a hit and cleared on mouseout", async () => {
		const { map, gl } = await setUp("none");
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		move(gl);
		expect(gl.canvas.style.cursor).toBe("pointer");
		gl.emit("mouseout", {});
		expect(gl.canvas.style.cursor).toBe("");
	});

	it("cursor is cleared off every feature, and untouched while nothing was hovered", async () => {
		const { map, gl } = await setUp("none");
		gl.canvas.style.cursor = "grabbing";
		gl.setRenderedFeatures([]);
		move(gl);
		expect(gl.canvas.style.cursor).toBe("grabbing");
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		move(gl);
		gl.setRenderedFeatures([]);
		move(gl);
		expect(gl.canvas.style.cursor).toBe("");
	});

	it("detach clears the cursor", async () => {
		const { map, gl } = await setUp("none");
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		move(gl);
		const canvas = gl.canvas;
		map.detach();
		expect(canvas.style.cursor).toBe("");
	});
});

describe("non-hoverable plugins", () => {
	const move = (gl: FakeGl) =>
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });

	/** A plugin with a blocking bubbles layer whose hover hit is the bubble itself. */
	const clusters: MapPlugin = {
		id: "clusters",
		setup(ctx) {
			const source = ctx.addSource("src", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			ctx.blocking([ctx.addLayer("bubbles", { type: "circle", source })], () => ({
				pluginId: "clusters",
				ref: { kind: "feature", id: "cluster:1" },
				refKey: "feature:cluster:1",
				name: ""
			}));
			return () => {};
		}
	};

	async function withSmoke(...others: MapPlugin[]) {
		const map = createMap({ config });
		// Drawn last and with a higher priority, so only `hoverable: false` keeps it from the hover.
		for (const plugin of others) map.addPlugin(plugin);
		map.addPlugin({ ...points("smoke", "region"), hoverable: false, hoverPriority: 5 });
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		return { map, gl };
	}

	it("a hover over only a non-hoverable feature hovers nothing and sets no pointer cursor", async () => {
		const { map, gl } = await withSmoke();
		gl.setRenderedFeatures([rendered(map, "smoke", "1")]);
		move(gl);
		expect(map.hovered).toBeNull();
		expect(gl.canvas.style.cursor).not.toBe("pointer");
	});

	it("a feature beneath a non-hoverable one takes the hover, whatever the priorities", async () => {
		const { map, gl } = await withSmoke(points("regions", "region"));
		gl.setRenderedFeatures([rendered(map, "smoke", "1"), rendered(map, "regions", "2")]);
		move(gl);
		expect(map.hovered?.hit.pluginId).toBe("regions");
		expect(gl.canvas.style.cursor).toBe("pointer");
	});

	it("a blocking bubble beneath a non-hoverable feature gives its own hover", async () => {
		const { map, gl } = await withSmoke(clusters);
		gl.setRenderedFeatures([
			rendered(map, "smoke", "1"),
			{
				layer: { id: `${map.uid}:clusters:bubbles` },
				source: `${map.uid}:clusters:src`,
				properties: {},
				geometry: { type: "Point", coordinates: [-119, 36] }
			}
		]);
		move(gl);
		expect(map.hovered?.hit.refKey).toBe("feature:cluster:1");
	});

	it("clicks and featuresAt still include non-hoverable hits", async () => {
		const { map, gl } = await withSmoke(points("regions", "region"));
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "smoke", "1"), rendered(map, "regions", "2")]);
		expect(map.featuresAt({ x: 1, y: 2 }).map((h) => h.pluginId)).toEqual(["smoke", "regions"]);
		click(gl);
		expect(handler).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pluginId: "smoke" }));
	});
});

describe("non-hoverable plugins with blocking layers", () => {
	it("a non-hoverable plugin's bubbles take no hover but still block clicks", async () => {
		const clicks: unknown[] = [];
		const map = createMap({ config });
		map.addPlugin(points("regions", "region"));
		map.addPlugin({
			id: "bubbles",
			hoverable: false,
			setup(ctx) {
				const source = ctx.addSource("src", {
					type: "geojson",
					data: { type: "FeatureCollection", features: [] }
				});
				ctx.blocking(
					[ctx.addLayer("bubbles", { type: "circle", source })],
					() => ({
						pluginId: "bubbles",
						ref: { kind: "feature", id: "cluster:1" },
						refKey: "feature:cluster:1",
						name: ""
					}),
					() => clicks.push("bubble")
				);
				return () => {};
			}
		});
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([
			{
				layer: { id: `${map.uid}:bubbles:bubbles` },
				source: `${map.uid}:bubbles:src`,
				properties: {},
				geometry: { type: "Point", coordinates: [-119, 36] }
			},
			rendered(map, "regions", "2")
		]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered?.hit.pluginId).toBe("regions");
		click(gl);
		expect(clicks).toEqual(["bubble"]);
		expect(handler).not.toHaveBeenCalled();
	});
});

describe("misses", () => {
	async function routerSetUp() {
		const router = new InteractionRouter();
		const gl = createFakeGl({ styleLoaded: true });
		gl.addSource("s", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
		gl.addLayer({ id: "a", type: "circle", source: "s" });
		gl.addLayer({ id: "bubbles", type: "circle", source: "s" });
		router.register("p", ["a"], () => ({
			pluginId: "p",
			ref: { kind: "feature", id: "x" },
			refKey: "feature:x",
			name: "X"
		}));
		const onBlockedClick = vi.fn();
		router.registerBlocking("p", ["bubbles"], undefined, onBlockedClick);
		router.attach(gl);
		await tick();
		const feature = (layer: string) => ({
			layer: { id: layer },
			source: "s",
			properties: {},
			geometry: { type: "Point" as const, coordinates: [-119, 36] }
		});
		return { router, gl, feature, onBlockedClick };
	}

	it("calls onMiss for a click that hits nothing", async () => {
		const { router, gl } = await routerSetUp();
		const onMiss = vi.fn();
		router.onMiss(onMiss);
		click(gl);
		expect(onMiss).toHaveBeenCalledTimes(1);
	});

	it("calls onMiss after a blocking layer's onClick", async () => {
		const { router, gl, feature, onBlockedClick } = await routerSetUp();
		const order: string[] = [];
		onBlockedClick.mockImplementation(() => order.push("blocked"));
		router.onMiss(() => order.push("miss"));
		gl.setRenderedFeatures([feature("bubbles")]);
		click(gl);
		expect(order).toEqual(["blocked", "miss"]);
	});

	it("doesn't call onMiss for a click with hits", async () => {
		const { router, gl, feature } = await routerSetUp();
		const onMiss = vi.fn();
		router.onMiss(onMiss);
		gl.setRenderedFeatures([feature("a")]);
		click(gl);
		expect(onMiss).not.toHaveBeenCalled();
	});

	it("stops calling after unsubscribe", async () => {
		const { router, gl } = await routerSetUp();
		const onMiss = vi.fn();
		router.onMiss(onMiss)();
		click(gl);
		expect(onMiss).not.toHaveBeenCalled();
	});
});

describe("pinned card", () => {
	/** A listed item for `points` features, so focus can find it. */
	function item(id: string): FeatureListItem {
		return {
			refKey: `monitor:${id}`,
			ref: { kind: "monitor", id },
			name: `Site ${id}`,
			value: null,
			level: NO_LEVEL,
			units: "",
			lngLat: [-119, 36],
			selectable: true
		};
	}

	async function cardSetUp(mode: "none" | "single" | "multiple" = "none") {
		const { map, gl, onselectionchange } = await setUp(mode);
		map.setCardEnabled(true);
		return { map, gl, onselectionchange };
	}

	it("doesn't pin while the card is off", async () => {
		const { map, gl } = await setUp("none");
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		expect(map.pinned).toBeNull();
	});

	it("pins the clicked feature at the click point", async () => {
		const { map, gl } = await cardSetUp();
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		expect(map.pinned?.hit.refKey).toBe("monitor:a");
		expect(map.pinned?.lngLat).toEqual([-119, 36]);
	});

	it("still selects and fires featureclick exactly as without the card", async () => {
		const { map, gl, onselectionchange } = await cardSetUp("multiple");
		const featureclick = vi.fn();
		map.on("featureclick", featureclick);
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["a"] });
		gl.setRenderedFeatures([rendered(map, "monitors", "b")]);
		click(gl, { pointerType: "touch" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["a", "b"] });
		expect(onselectionchange).toHaveBeenCalledTimes(2);
		expect(featureclick).toHaveBeenCalledTimes(2);
		expect(map.pinned?.hit.refKey).toBe("monitor:b");
	});

	it("moves the pin on a click on another feature", async () => {
		const { map, gl } = await cardSetUp();
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		gl.setRenderedFeatures([rendered(map, "monitors", "b")]);
		click(gl);
		expect(map.pinned?.hit.refKey).toBe("monitor:b");
	});

	it("unpins on a click that hits nothing", async () => {
		const { map, gl } = await cardSetUp();
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		gl.setRenderedFeatures([]);
		click(gl);
		expect(map.pinned).toBeNull();
	});

	it("unpins on a click on a non-hoverable plugin's feature", async () => {
		const map = createMap({ config });
		map.addPlugin({ ...points("smoke"), hoverable: false });
		map.addPlugin(points("monitors"));
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.setCardEnabled(true);
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		gl.setRenderedFeatures([rendered(map, "smoke", "p")]);
		click(gl);
		expect(map.pinned).toBeNull();
	});

	it("pins a focused list item and keeps it when focus clears", async () => {
		const map = createMap({ config });
		map.addPlugin({ ...points("monitors"), features: () => [item("a")] });
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.setCardEnabled(true);
		map.focusFeature("monitor:a", "monitors");
		expect(map.pinned?.hit).toEqual({
			pluginId: "monitors",
			ref: { kind: "monitor", id: "a" },
			refKey: "monitor:a",
			name: "Site a"
		});
		map.focusFeature(null);
		expect(map.pinned?.hit.refKey).toBe("monitor:a");
	});

	it("unpins when the pinned feature's plugin is removed", async () => {
		const { map, gl } = await cardSetUp();
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		map.removePlugin("monitors");
		expect(map.pinned).toBeNull();
	});

	it("setCardEnabled(false) unpins", async () => {
		const { map, gl } = await cardSetUp();
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		map.setCardEnabled(false);
		expect(map.pinned).toBeNull();
	});

	it("unpin() clears it, and does nothing when nothing is pinned", async () => {
		const { map, gl } = await cardSetUp();
		map.unpin();
		expect(map.pinned).toBeNull();
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		map.unpin();
		expect(map.pinned).toBeNull();
	});

	it("two maps never share a pin", async () => {
		const one = await cardSetUp();
		const two = await cardSetUp();
		one.gl.setRenderedFeatures([rendered(one.map, "monitors", "a")]);
		click(one.gl);
		expect(one.map.pinned?.hit.refKey).toBe("monitor:a");
		expect(two.map.pinned).toBeNull();
	});
});

describe("click modifiers", () => {
	async function picks() {
		const router = new InteractionRouter();
		const gl = createFakeGl({ styleLoaded: true });
		gl.addSource("s", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
		gl.addLayer({ id: "a", type: "circle", source: "s" });
		router.register("p", ["a"], () => ({
			pluginId: "p",
			ref: { kind: "feature", id: "x" },
			refKey: "feature:x",
			name: "X"
		}));
		router.attach(gl);
		await tick();
		gl.setRenderedFeatures([
			{
				layer: { id: "a" },
				source: "s",
				properties: {},
				geometry: { type: "Point" as const, coordinates: [-119, 36] }
			}
		]);
		const events: Array<{ modifier: boolean; touch: boolean; additive: boolean }> = [];
		router.onPick((e) =>
			events.push({ modifier: e.modifier, touch: e.touch, additive: e.additive })
		);
		return { gl, events };
	}

	it("reports a plain click", async () => {
		const { gl, events } = await picks();
		click(gl);
		expect(events).toEqual([{ modifier: false, touch: false, additive: false }]);
	});

	it("reports a Shift click as a modifier", async () => {
		const { gl, events } = await picks();
		click(gl, { shiftKey: true });
		expect(events).toEqual([{ modifier: true, touch: false, additive: true }]);
	});

	it("reports a touch tap as touch, not a modifier", async () => {
		const { gl, events } = await picks();
		click(gl, { pointerType: "touch" });
		expect(events).toEqual([{ modifier: false, touch: true, additive: true }]);
	});
});

describe("modifier mode and refusals", () => {
	async function modSetUp(
		mode: "single" | "multiple",
		extra: Partial<Parameters<MapContext["addPlugin"]>[1]> = {}
	) {
		const map = createMap({ config });
		const onselectionchange = vi.fn();
		map.addPlugin(points("monitors"), {
			selectionMode: mode,
			pickWith: "modifier",
			onselectionchange,
			...extra
		});
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.setCardEnabled(true);
		const clickOn = (id: string, originalEvent: Record<string, unknown> = {}) => {
			gl.setRenderedFeatures([rendered(map, "monitors", id)]);
			click(gl, originalEvent);
		};
		return { map, gl, onselectionchange, clickOn };
	}
	const ids = (map: MapContext) => map.getSelection("monitors")?.ids ?? null;
	const cap1 = (next: { ids: string[] } | null) =>
		(next?.ids.length ?? 0) <= 1 || "Up to 1 monitor";

	it("modifier mode: a plain click pins and selects nothing", async () => {
		const { map, clickOn, onselectionchange } = await modSetUp("multiple");
		const featureclick = vi.fn();
		map.on("featureclick", featureclick);
		clickOn("a");
		expect(ids(map)).toBeNull();
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(featureclick).toHaveBeenCalledTimes(1);
		expect(map.pinned?.hit.refKey).toBe("monitor:a");
	});

	it("modifier mode: Shift-click toggles in multiple mode", async () => {
		const { map, clickOn } = await modSetUp("multiple");
		clickOn("a", { shiftKey: true });
		clickOn("b", { metaKey: true });
		clickOn("a", { ctrlKey: true });
		expect(ids(map)).toEqual(["b"]);
	});

	it("modifier mode: Shift-click in single mode selects, then clears", async () => {
		const { map, clickOn } = await modSetUp("single");
		clickOn("a", { shiftKey: true });
		expect(ids(map)).toEqual(["a"]);
		clickOn("a", { shiftKey: true });
		expect(ids(map)).toBeNull();
	});

	it("modifier mode: a touch tap only pins, even in multiple mode", async () => {
		const { map, clickOn } = await modSetUp("multiple");
		clickOn("a", { pointerType: "touch" });
		expect(ids(map)).toBeNull();
		expect(map.pinned?.hit.refKey).toBe("monitor:a");
	});

	it("modifier mode: a list pick toggles only when additive", async () => {
		const map = createMap({ config });
		map.addPlugin(
			{ ...points("monitors"), features: () => [listed("a")] },
			{ selectionMode: "multiple", pickWith: "modifier" }
		);
		map.attach(createFakeGl({ styleLoaded: true }));
		await tick();
		map.pickFromList("monitors", "monitor:a", false);
		expect(ids(map)).toBeNull();
		map.pickFromList("monitors", "monitor:a", true);
		expect(ids(map)).toEqual(["a"]);
		map.pickFromList("monitors", "monitor:a", true);
		expect(ids(map)).toBeNull();
	});

	it("canSelect refuses: selection unchanged, no onselectionchange, notice set", async () => {
		const { map, clickOn, onselectionchange } = await modSetUp("multiple", { canSelect: cap1 });
		clickOn("a", { shiftKey: true });
		expect(onselectionchange).toHaveBeenCalledTimes(1);
		clickOn("b", { shiftKey: true });
		expect(ids(map)).toEqual(["a"]);
		expect(onselectionchange).toHaveBeenCalledTimes(1);
		expect(map.notice?.message).toBe("Up to 1 monitor");
		const first = map.notice!.id;
		clickOn("c", { shiftKey: true });
		expect(map.notice?.id).toBeGreaterThan(first);
	});

	it("the next allowed pick clears the notice", async () => {
		const { map, clickOn } = await modSetUp("multiple", { canSelect: cap1 });
		clickOn("a", { shiftKey: true });
		clickOn("b", { shiftKey: true });
		expect(map.notice).not.toBeNull();
		clickOn("a", { shiftKey: true });
		expect(ids(map)).toBeNull();
		expect(map.notice).toBeNull();
	});

	it("canSelect returning an empty message refuses quietly", async () => {
		const { map, clickOn } = await modSetUp("multiple", { canSelect: () => "" });
		clickOn("a", { shiftKey: true });
		expect(ids(map)).toBeNull();
		expect(map.notice).toBeNull();
	});

	it("canSelect that throws refuses quietly and logs", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { map, clickOn } = await modSetUp("multiple", {
			canSelect: () => {
				throw new Error("boom");
			}
		});
		clickOn("a", { shiftKey: true });
		expect(ids(map)).toBeNull();
		expect(map.notice).toBeNull();
		expect(error).toHaveBeenCalledWith("map-sdk: canSelect failed", expect.any(Error));
		error.mockRestore();
	});

	it("canSelect isn't asked for setSelection or Clear", async () => {
		const canSelect = vi.fn(() => "no" as const);
		const { map } = await modSetUp("multiple", { canSelect });
		map.setSelection("monitors", { kind: "monitors", ids: ["a", "b"] });
		map.clearSelection("monitors");
		expect(canSelect).not.toHaveBeenCalled();
		expect(ids(map)).toBeNull();
	});

	it("togglePick toggles with the same rules and refusal, in either mode", async () => {
		for (const pickWith of ["click", "modifier"] as const) {
			const { map, onselectionchange } = await modSetUp("multiple", { pickWith, canSelect: cap1 });
			map.togglePick("monitors", { kind: "monitor", id: "a" });
			expect(ids(map)).toEqual(["a"]);
			map.togglePick("monitors", { kind: "monitor", id: "b" });
			expect(ids(map)).toEqual(["a"]);
			expect(map.notice?.message).toBe("Up to 1 monitor");
			map.togglePick("monitors", { kind: "monitor", id: "a" });
			expect(ids(map)).toBeNull();
			expect(onselectionchange).toHaveBeenCalledTimes(2);
		}
	});

	it("click mode with no canSelect behaves as before", async () => {
		const { map, gl } = await setUp("multiple");
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		click(gl);
		gl.setRenderedFeatures([rendered(map, "monitors", "b")]);
		click(gl);
		expect(ids(map)).toEqual(["b"]);
		click(gl, { shiftKey: true });
		expect(ids(map)).toBeNull();
		expect(map.getPickWith("monitors")).toBe("click");
		expect(map.notice).toBeNull();
	});
});

function listed(id: string): FeatureListItem {
	return {
		refKey: `monitor:${id}`,
		ref: { kind: "monitor", id },
		name: `Site ${id}`,
		value: null,
		level: NO_LEVEL,
		units: "",
		lngLat: [-119, 36],
		selectable: true
	};
}

describe("Shift-click through MapLibre's box zoom", () => {
	/** MapLibre turns a Shift press and release in place into `boxzoomcancel`, with no click. */
	function shiftRelease(gl: FakeGl) {
		gl.emit("boxzoomcancel", {
			originalEvent: { type: "mouseup", button: 0, shiftKey: true, clientX: 10, clientY: 20 }
		});
	}

	async function boxSetUp(pickWith: "click" | "modifier") {
		const map = createMap({ config });
		map.addPlugin(points("monitors"), { selectionMode: "multiple", pickWith });
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.setCardEnabled(true);
		gl.setRenderedFeatures([rendered(map, "monitors", "a")]);
		const featureclick = vi.fn();
		map.on("featureclick", featureclick);
		return { map, gl, featureclick };
	}

	it("picks as a Shift-click in modifier mode", async () => {
		const { map, gl, featureclick } = await boxSetUp("modifier");
		shiftRelease(gl);
		expect(map.getSelection("monitors")?.ids).toEqual(["a"]);
		expect(featureclick).toHaveBeenCalledTimes(1);
		expect(map.pinned?.hit.refKey).toBe("monitor:a");
	});

	it("is ignored in click mode, as before", async () => {
		const { map, gl, featureclick } = await boxSetUp("click");
		shiftRelease(gl);
		expect(map.getSelection("monitors")).toBeNull();
		expect(featureclick).not.toHaveBeenCalled();
		expect(map.pinned).toBeNull();
	});

	it("ignores a Shift-drag that drew a box and came back to its start", async () => {
		const { map, gl } = await boxSetUp("modifier");
		gl.emit("boxzoomstart", {});
		shiftRelease(gl);
		expect(map.getSelection("monitors")).toBeNull();
		shiftRelease(gl);
		expect(map.getSelection("monitors")?.ids).toEqual(["a"]);
	});

	it("measures the point like MapLibre, under a CSS scale on the map", async () => {
		const { map, gl } = await boxSetUp("modifier");
		// Drawn at twice its layout size (a scale(2) ancestor), 4px from the page's corner.
		Object.assign(gl.canvas, {
			getBoundingClientRect: () => ({ left: 4, top: 4, width: 200, height: 200 }),
			offsetWidth: 100,
			offsetHeight: 100,
			clientLeft: 0,
			clientTop: 0
		});
		shiftRelease(gl);
		// clientX 10, clientY 20 → ((10 - 4) / 2, (20 - 4) / 2); the fake's unproject echoes it.
		expect(map.pinned?.lngLat).toEqual([3, 8]);
	});

	it("ignores a boxzoomcancel from Esc, which has no pointer position", async () => {
		const { map, gl } = await boxSetUp("modifier");
		gl.emit("boxzoomcancel", { originalEvent: { type: "keydown", key: "Escape" } });
		expect(map.getSelection("monitors")).toBeNull();
	});
});
