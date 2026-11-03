import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
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

function setUp(mode: "none" | "single" | "multiple", selection = null as null | string[]) {
	const map = createMap({ config });
	const onselectionchange = vi.fn();
	map.addPlugin(points("monitors"), {
		selectionMode: mode,
		selection: selection && { kind: "monitors", ids: selection },
		onselectionchange
	});
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	return { map, gl, onselectionchange };
}

const stops: Array<() => void> = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

describe("picking", () => {
	it("reports a click on a feature as featureclick with its plugin and ref", () => {
		const { map, gl } = setUp("none");
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "monitors", "7")]);
		click(gl);
		expect(handler).toHaveBeenCalledExactlyOnceWith({
			pluginId: "monitors",
			ref: { kind: "monitor", id: "7" }
		});
		expect(map.getSelection("monitors")).toBeNull();
	});

	it("replaces the selection on a plain click", () => {
		const { map, gl, onselectionchange } = setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
		expect(onselectionchange).toHaveBeenCalledExactlyOnceWith({ kind: "monitors", ids: ["2"] });
	});

	it("toggles with shift, meta, or ctrl in multiple mode", () => {
		const { map, gl, onselectionchange } = setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, { shiftKey: true });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });
		click(gl, { metaKey: true });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
		click(gl, { ctrlKey: true });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });
		expect(onselectionchange).toHaveBeenCalledTimes(3);
	});

	it("toggles on a touch tap in multiple mode", () => {
		const { map, gl } = setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, { pointerType: "touch" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });
		gl.setRenderedFeatures([rendered(map, "monitors", "1")]);
		click(gl, { pointerType: "touch" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("treats a MouseEvent click after a touch pointerdown as a touch tap", () => {
		// Safari before 17 dispatches click as a MouseEvent, with no pointerType.
		const { map, gl } = setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		gl.canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
		click(gl, {});
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });

		// Cleared after each click: a later plain click replaces.
		click(gl, {});
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("lets the click's own pointerType win over the recorded one", () => {
		const { map, gl } = setUp("multiple", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		gl.canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
		click(gl, { pointerType: "mouse" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("stops recording pointerdown after detach", () => {
		const { map, gl } = setUp("multiple", ["1"]);
		map.detach();
		gl.canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch" }));
		map.attach(gl);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, {});
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("replaces on shift-click and touch in single mode", () => {
		const { map, gl } = setUp("single", ["1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, { shiftKey: true });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		click(gl, { pointerType: "touch" });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["3"] });
	});

	it("keeps host ids that are not in the data when toggling", () => {
		const { map, gl, onselectionchange } = setUp("multiple", ["999", "1"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl, { shiftKey: true });
		expect(onselectionchange).toHaveBeenCalledExactlyOnceWith({
			kind: "monitors",
			ids: ["999", "1", "2"]
		});
	});

	it("does not call onselectionchange when the pick changes nothing", () => {
		const { map, gl, onselectionchange } = setUp("single", ["2"]);
		gl.setRenderedFeatures([rendered(map, "monitors", "2")]);
		click(gl);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
		expect(onselectionchange).not.toHaveBeenCalled();
	});

	it("does nothing on a click with no hits", () => {
		const { map, gl, onselectionchange } = setUp("multiple", ["1"]);
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([]);
		click(gl);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
		expect(handler).not.toHaveBeenCalled();
		expect(onselectionchange).not.toHaveBeenCalled();
	});

	it("picks only the top hit, for its own plugin", () => {
		const map = createMap({ config });
		const onMonitors = vi.fn();
		const onRegions = vi.fn();
		map.addPlugin(points("monitors"), { selectionMode: "single", onselectionchange: onMonitors });
		map.addPlugin(points("regions", "region"), {
			selectionMode: "single",
			onselectionchange: onRegions
		});
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		gl.setRenderedFeatures([rendered(map, "regions", "019"), rendered(map, "monitors", "1")]);
		click(gl);
		expect(map.getSelection("regions")).toEqual({ kind: "regions", ids: ["county:019"] });
		expect(onRegions).toHaveBeenCalledOnce();
		expect(map.getSelection("monitors")).toBeNull();
		expect(onMonitors).not.toHaveBeenCalled();
	});

	it("keeps two maps apart", () => {
		const a = setUp("multiple");
		const b = setUp("multiple");
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

	it("stops reporting clicks after destroy", () => {
		const { map, gl, onselectionchange } = setUp("multiple");
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "monitors", "1")]);
		map.destroy();
		click(gl);
		expect(handler).not.toHaveBeenCalled();
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(gl.listeners.filter((l) => l.type === "click")).toEqual([]);
	});

	it("stops reporting clicks after detach and resumes on attach", () => {
		const { map, gl } = setUp("multiple");
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([rendered(map, "monitors", "1")]);
		map.detach();
		click(gl);
		expect(handler).not.toHaveBeenCalled();
		const next = createFakeGl({ styleLoaded: true });
		map.attach(next);
		next.setRenderedFeatures([rendered(map, "monitors", "1")]);
		click(next);
		expect(handler).toHaveBeenCalledOnce();
	});
});

describe("featuresAt", () => {
	it("returns hits from two plugins, topmost first, de-duplicated", () => {
		const map = createMap({ config });
		map.addPlugin(points("monitors"));
		map.addPlugin(points("regions", "region"));
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
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

	it("skips features whose toHit returns null, and layers nobody registered", () => {
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
		const feature = (layer: string, id: string) => ({
			layer: { id: layer },
			source: "s",
			properties: { id },
			geometry: { type: "Point" as const, coordinates: [0, 0] }
		});
		gl.setRenderedFeatures([feature("other", "1"), feature("a", "skip"), feature("a", "2")]);
		expect(router.hitsAt([0, 0]).map((h) => h.refKey)).toEqual(["feature:x"]);
	});

	it("returns no hits while detached or when no layer is registered", () => {
		const map = createMap({ config });
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([]);
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([]);
		expect(gl.calls).not.toContain("queryRenderedFeatures");
	});
});

describe("hover", () => {
	it("sets hovered on mousemove over a registered layer and clears it on mouseout", () => {
		const { map, gl } = setUp("none");
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

	it("clears hovered on mousemove off every registered layer", () => {
		const { map, gl } = setUp("none");
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered?.hit.refKey).toBe("monitor:3");
		gl.setRenderedFeatures([]);
		gl.emit("mousemove", { point: { x: 5, y: 5 }, lngLat: { lng: -119, lat: 36 } });
		expect(map.hovered).toBeNull();
	});

	it("clears hovered on detach and when the hovered plugin is removed", () => {
		const { map, gl } = setUp("none");
		gl.setRenderedFeatures([rendered(map, "monitors", "3")]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		map.removePlugin("monitors");
		expect(map.hovered).toBeNull();

		map.addPlugin(points("monitors"));
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		expect(map.hovered?.hit.refKey).toBe("monitor:3");
		map.detach();
		expect(map.hovered).toBeNull();
	});
});
