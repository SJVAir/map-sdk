import { afterEach, describe, expect, it, vi } from "vitest";
import { createMap, type MapContext } from "../../../src/lib/core/create-map.svelte.js";
import type { MapPlugin } from "../../../src/lib/core/plugin.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";

const config = { maptilerKey: "test-key" };

function setUp(zoom = 7) {
	const map = createMap({ config });
	const gl = createFakeGl({ styleLoaded: true });
	gl.jumpTo({ zoom });
	gl.moves.length = 0;
	map.attach(gl);
	return { map, gl };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("camera moves", () => {
	it("easeTo with minZoom keeps a deeper zoom", () => {
		const { map, gl } = setUp(13);
		map.easeTo({ center: [1, 2], minZoom: 12 });
		expect(gl.moves).toEqual([{ method: "easeTo", options: { center: [1, 2], zoom: 13 } }]);
	});

	it("easeTo with minZoom zooms in from a shallower zoom", () => {
		const { map, gl } = setUp(7);
		map.easeTo({ center: [1, 2], minZoom: 12 });
		expect(gl.moves).toEqual([{ method: "easeTo", options: { center: [1, 2], zoom: 12 } }]);
	});

	it("easeTo prefers zoom over minZoom", () => {
		const { map, gl } = setUp(13);
		map.easeTo({ center: [1, 2], zoom: 9, minZoom: 12 });
		expect(gl.moves[0].options).toEqual({ center: [1, 2], zoom: 9 });
	});

	it("flyTo passes zoom 16", () => {
		const { map, gl } = setUp();
		map.flyTo({ center: [1, 2], zoom: 16 });
		expect(gl.moves).toEqual([{ method: "flyTo", options: { center: [1, 2], zoom: 16 } }]);
	});

	it("fitBounds passes padding and maxZoom", () => {
		const { map, gl } = setUp();
		const bounds = { west: -120, south: 35, east: -118, north: 37 };
		map.fitBounds(bounds, { padding: 40, maxZoom: 14 });
		expect(gl.moves).toEqual([
			{
				method: "fitBounds",
				options: {
					bounds: [
						[-120, 35],
						[-118, 37]
					],
					padding: 40,
					maxZoom: 14
				}
			}
		]);
	});

	it("camera moves under reduced motion have duration 0", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }));
		const { map, gl } = setUp();
		map.easeTo({ center: [1, 2], zoom: 10 });
		map.flyTo({ center: [1, 2], zoom: 16 });
		map.fitBounds({ west: 0, south: 0, east: 1, north: 1 });
		expect(gl.moves.map((m) => m.options.duration)).toEqual([0, 0, 0]);
	});

	it("camera moves while detached or destroyed do nothing", () => {
		const { map, gl } = setUp();
		map.detach();
		expect(() => {
			map.easeTo({ center: [1, 2] });
			map.flyTo({ center: [1, 2] });
			map.fitBounds({ west: 0, south: 0, east: 1, north: 1 });
		}).not.toThrow();
		expect(gl.moves).toEqual([]);
		const second = setUp();
		second.map.destroy();
		expect(() => second.map.flyTo({ center: [1, 2] })).not.toThrow();
		expect(second.gl.moves).toEqual([]);
	});
});

function points(): MapPlugin {
	return {
		id: "monitors",
		setup(ctx) {
			const source = ctx.addSource("src", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			const layer = ctx.addLayer("points", { type: "circle", source });
			ctx.interactive([layer], (props) => ({
				pluginId: "monitors",
				ref: { kind: "monitor", id: String(props.id) },
				refKey: `monitor:${props.id}`,
				name: "Site"
			}));
			return () => {};
		},
		features: () => [
			{
				ref: { kind: "monitor", id: "1" },
				refKey: "monitor:1",
				name: "Site 1",
				level: -1,
				units: "",
				lngLat: [3, 4],
				selectable: true
			} as never
		]
	};
}

describe("featureclick lngLat", () => {
	it("carries the click lngLat", () => {
		const map: MapContext = createMap({ config });
		map.addPlugin(points());
		const gl: FakeGl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		const handler = vi.fn();
		map.on("featureclick", handler);
		gl.setRenderedFeatures([
			{
				layer: { id: `${map.uid}:monitors:points` },
				source: `${map.uid}:monitors:src`,
				properties: { id: "1" },
				geometry: { type: "Point", coordinates: [1, 2] }
			}
		]);
		gl.emit("click", { point: { x: 1, y: 1 }, lngLat: { lng: 1, lat: 2 }, originalEvent: {} });
		expect(handler).toHaveBeenCalledExactlyOnceWith({
			pluginId: "monitors",
			ref: { kind: "monitor", id: "1" },
			lngLat: [1, 2]
		});
	});

	it("pickFromList featureclick carries the item lngLat", () => {
		const map = createMap({ config });
		map.addPlugin(points());
		const handler = vi.fn();
		map.on("featureclick", handler);
		map.pickFromList("monitors", "monitor:1", false);
		expect(handler).toHaveBeenCalledExactlyOnceWith({
			pluginId: "monitors",
			ref: { kind: "monitor", id: "1" },
			lngLat: [3, 4]
		});
	});
});
