import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, tick } from "svelte";
import { createMap, type MapContext } from "../../../src/lib/core/create-map.svelte.js";
import { InteractionRouter } from "../../../src/lib/core/interactions.svelte.js";
import type { MapPlugin } from "../../../src/lib/core/plugin.js";
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
