import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, tick } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { createMap, type MapContext } from "../../../src/lib/core/create-map.svelte.js";
import type { FeatureListItem, MapPlugin, PluginContext } from "../../../src/lib/core/plugin.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";
import type { Geometry } from "geojson";
import { labelPoint } from "../../../src/lib/plugins/shapes.svelte.js";
import { rootEffect } from "../../fixtures/effects.svelte.js";
import { plumeFeature } from "../../fixtures/plume.js";
import { createFakeGl } from "../../fixtures/fake-gl.js";

const config = { maptilerKey: "test-key" };

/** A plugin that adds one source and logs setup, teardown, and its selected keys. */
function plugin(id: string, log: string[] = [], extra: Partial<MapPlugin> = {}): MapPlugin {
	return {
		id,
		setup(ctx: PluginContext) {
			log.push(`setup:${id}`);
			ctx.addSource("src", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
			ctx.effect(() => {
				log.push(`keys:${id}:${[...ctx.selectedKeys].join(",")}`);
			});
			return () => log.push(`teardown:${id}`);
		},
		...extra
	};
}

const stops: Array<() => void> = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

describe("createMap", () => {
	it("defaults the initial view, gestures, and providers", () => {
		const map = createMap({ config });
		expect(map.config.initialView).toEqual({
			center: [-119.7987626619462, 36.76272050981146],
			zoom: 7,
			bearing: 0,
			pitch: 0
		});
		expect(map.config.cooperativeGestures).toBe(false);
		expect(map.config.maptilerKey).toBe("test-key");
		expect(map.camera).toEqual(map.config.initialView);
		expect(map.bounds).toBeNull();
		expect(map.messages).toBe(defaultMessages);
		expect(typeof map.metadata.scale).toBe("function");
		expect(typeof map.format.dateTime).toBe("function");
		expect(map.uid).toMatch(/^[0-9a-f]{8}$/);
		expect(map.attached).toBe(false);
	});

	it("orders plugins with addPlugin's before and movePlugin", async () => {
		const map = createMap({ config });
		const layered = (id: string): MapPlugin => ({
			id,
			setup(ctx) {
				ctx.addLayer("bg", { type: "background" });
				return () => {};
			}
		});
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.addPlugin(layered("a"));
		await tick();
		map.addPlugin(layered("b"), { before: "a", selectionMode: "single" });
		await tick();
		expect(map.plugins.map((p) => p.id)).toEqual(["b", "a"]);
		expect(map.getSelectionMode("b")).toBe("single");
		expect(gl.layers.map((l) => l.id)).toEqual([`${map.uid}:b:bg`, `${map.uid}:a:bg`]);
		expect(() => map.addPlugin(layered("c"), { before: "nope" })).toThrow("nope");
		expect(map.getSelectionMode("c")).toBe("none");

		map.movePlugin("b");
		expect(map.plugins.map((p) => p.id)).toEqual(["a", "b"]);
		expect(gl.layers.map((l) => l.id)).toEqual([`${map.uid}:a:bg`, `${map.uid}:b:bg`]);
		map.movePlugin("b", { before: "a" });
		expect(map.plugins.map((p) => p.id)).toEqual(["b", "a"]);
	});

	it("keeps two maps apart", async () => {
		const a = createMap({ config });
		const b = createMap({ config });
		expect(a.uid).not.toBe(b.uid);

		a.addPlugin(plugin("monitors"), { selectionMode: "multiple" });
		await tick();
		expect(a.plugins.map((p) => p.id)).toEqual(["monitors"]);
		expect(b.plugins).toEqual([]);

		b.addPlugin(plugin("monitors"));
		await tick();
		a.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		expect(a.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
		expect(b.getSelection("monitors")).toBeNull();

		const glA = createFakeGl({ styleLoaded: true });
		const glB = createFakeGl({ styleLoaded: true });
		a.attach(glA);
		await tick();
		b.attach(glB);
		await tick();
		expect([...glA.sources.keys()]).toEqual([`${a.uid}:monitors:src`]);
		expect([...glB.sources.keys()]).toEqual([`${b.uid}:monitors:src`]);
	});

	it("keeps selection and camera across detach and attach, and sets plugins up again", async () => {
		const map = createMap({ config });
		const log: string[] = [];
		map.addPlugin(plugin("monitors", log), { selectionMode: "single" });
		await tick();
		const first = createFakeGl({ styleLoaded: true });
		map.attach(first);
		await tick();
		expect(map.attached).toBe(true);
		map.setSelection("monitors", { kind: "monitors", ids: ["7"] });
		const camera = { center: [-120, 37] as [number, number], zoom: 9, bearing: 10, pitch: 20 };
		const bounds = { west: -121, south: 36, east: -119, north: 38 };
		map.updateView(camera, bounds);

		map.detach();
		expect(map.attached).toBe(false);
		expect(first.sources.size).toBe(0);

		const second = createFakeGl({ styleLoaded: true });
		log.length = 0;
		map.attach(second);
		await tick();
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["7"] });
		expect(map.camera).toEqual(camera);
		expect(map.bounds).toEqual(bounds);
		expect(log).toEqual(["setup:monitors", "keys:monitors:monitor:7"]);
		expect([...second.sources.keys()]).toEqual([`${map.uid}:monitors:src`]);
	});

	it("gives each plugin its own selection, reactively, through selectedKeys", async () => {
		const map = createMap({ config });
		const log: string[] = [];
		map.addPlugin(plugin("monitors", log), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] }
		});
		await tick();
		map.addPlugin(plugin("regions", log));
		await tick();
		map.attach(createFakeGl({ styleLoaded: true }));
		await tick();
		expect(log).toContain("keys:monitors:monitor:1");
		expect(log).toContain("keys:regions:");

		log.length = 0;
		map.setSelection("regions", { kind: "regions", ids: ["county:019"] });
		flushSync();
		expect(log).toEqual(["keys:regions:region:county:019"]);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
	});

	it("keeps selected ids that are not in any data", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selectionMode: "multiple" });
		await tick();
		map.attach(createFakeGl({ styleLoaded: true }));
		await tick();
		map.setSelection("monitors", { kind: "monitors", ids: ["no-such-1", "no-such-2"] });
		flushSync();
		expect(map.getSelection("monitors")).toEqual({
			kind: "monitors",
			ids: ["no-such-1", "no-such-2"]
		});
	});

	it("does not call onselectionchange when the host sets the selection", async () => {
		const map = createMap({ config });
		const onselectionchange = vi.fn();
		map.addPlugin(plugin("monitors"), { selectionMode: "single", onselectionchange });
		await tick();
		map.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		map.setSelection("monitors", null);
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(map.getSelection("monitors")).toBeNull();
	});

	it("makes getSelection reactive", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"));
		await tick();
		const seen: Array<string[] | null> = [];
		stops.push(rootEffect(() => seen.push(map.getSelection("monitors")?.ids ?? null)));
		flushSync();
		map.setSelection("monitors", { kind: "monitors", ids: ["3"] });
		flushSync();
		expect(seen).toEqual([null, ["3"]]);
	});

	it("drops a plugin's selection when it is removed", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selection: { kind: "monitors", ids: ["1"] } });
		await tick();
		map.removePlugin("monitors");
		expect(map.plugins).toEqual([]);
		expect(map.getSelection("monitors")).toBeNull();
	});

	it("leaves the first plugin's selection alone when a duplicate id is added", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selection: { kind: "monitors", ids: ["1"] } });
		await tick();
		expect(() =>
			map.addPlugin(plugin("monitors"), { selection: { kind: "monitors", ids: ["2"] } })
		).toThrow(/already added/);
		await tick();
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
	});

	it("focuses a feature: marks it and pans to it", async () => {
		const map = createMap({ config });
		map.addPlugin(
			plugin("monitors", [], {
				features: () => [
					{
						refKey: "monitor:5",
						ref: { kind: "monitor", id: "5" },
						name: "Five",
						value: null,
						level: { key: "x" } as never,
						units: "",
						lngLat: [-118.5, 35.25],
						selectable: true
					}
				]
			})
		);
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.focusFeature("monitor:5");
		expect(map.focusedKey).toBe("monitor:5");
		expect(gl.getCenter()).toEqual({ lng: -118.5, lat: 35.25 });

		// Beside the open list panel, the feature lands in the middle of the part left clear.
		const easeTo = vi.spyOn(gl, "easeTo");
		map.setListInset(240);
		map.focusFeature("monitor:5");
		expect(easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ offset: [120, 0] }));
		expect(easeTo.mock.lastCall![0]).not.toHaveProperty("padding");
		// A panel on the right: the clear part is on the left.
		map.setListInset(240, "right");
		map.focusFeature("monitor:5");
		expect(easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ offset: [-120, 0] }));
		map.setListInset(0);
		map.focusFeature("monitor:5");
		expect(easeTo.mock.lastCall![0]).not.toHaveProperty("offset");
	});

	describe("focusing a shape", () => {
		// The fake GL map starts at (-119.7, 36.7), zoom 7: its view spans lng -122.5125 to
		// -116.8875 and lat 35.29375 to 38.10625.
		const square = (west: number, south: number, east: number, north: number): Geometry => ({
			type: "Polygon",
			coordinates: [
				[
					[west, south],
					[east, south],
					[east, north],
					[west, north],
					[west, south]
				]
			]
		});
		const shapeItem = (
			refKey: string,
			geometry: Geometry | undefined,
			lngLat: [number, number]
		): FeatureListItem => ({
			refKey,
			ref: { kind: "feature", id: refKey },
			name: refKey,
			value: null,
			level: NO_LEVEL,
			units: "",
			lngLat,
			...(geometry && { geometry }),
			selectable: false
		});
		const plume = plumeFeature().geometry;

		async function shapesMap(items: FeatureListItem[]) {
			const map = createMap({ config });
			map.addPlugin(plugin("shapes", [], { features: () => items }));
			await tick();
			const gl = createFakeGl({ styleLoaded: true });
			map.attach(gl);
			await tick();
			return { map, gl };
		}

		it("focusing a covering plume doesn't move the camera", async () => {
			const { map, gl } = await shapesMap([shapeItem("p", plume, labelPoint(plume)!)]);
			map.focusFeature("p");
			expect(gl.getCenter()).toEqual({ lng: -119.7, lat: 36.7 });
			// Nothing was moving, so nothing is stopped: no move at all.
			expect(gl.moves).toEqual([]);
			expect(map.focusedAnchor).toEqual([-119.7, 36.7]);
		});

		it("a no-move focus stops an earlier focus's ease that is still running", async () => {
			const point = shapeItem("m", undefined, [-119.5, 36.6]);
			const { map, gl } = await shapesMap([point, shapeItem("p", plume, labelPoint(plume)!)]);
			map.focusFeature("m");
			map.focusFeature("p");
			expect(gl.moves).toHaveLength(2);
			expect(gl.moves[1].options).toEqual({ center: [-119.5, 36.6], duration: 0 });
		});

		describe("picking it from the list (Enter)", () => {
			const clicks = (map: MapContext) => {
				const seen: Array<[number, number]> = [];
				map.on("featureclick", ({ lngLat }) => seen.push(lngLat));
				return seen;
			};

			it("reports where the focused row's tooltip pins", async () => {
				const big = square(-125, 30, -110, 40);
				const { map, gl } = await shapesMap([shapeItem("b", big, [-117.5, 31])]);
				Object.defineProperty(gl.canvas, "clientWidth", { value: 800 });
				map.setListInset(240);
				const seen = clicks(map);
				map.focusFeature("b", "shapes");
				map.pickFromList("shapes", "b", false);
				expect(seen).toEqual([map.focusedAnchor]);
				expect(seen[0][0]).toBeCloseTo(-119.7 + 0.15 * 5.625);
			});

			it("reports a point of the shape in view when the row isn't focused", async () => {
				const { map } = await shapesMap([shapeItem("p", plume, labelPoint(plume)!)]);
				const seen = clicks(map);
				map.pickFromList("shapes", "p", false);
				expect(seen).toEqual([[-119.7, 36.7]]);
			});

			it("still reports a point's own position", async () => {
				const { map } = await shapesMap([shapeItem("m", undefined, [-119.5, 36.6])]);
				const seen = clicks(map);
				map.focusFeature("m", "shapes");
				map.pickFromList("shapes", "m", false);
				expect(seen).toEqual([[-119.5, 36.6]]);
			});
		});

		it("once that ease has ended, a no-move focus sends no move", async () => {
			const point = shapeItem("m", undefined, [-119.5, 36.6]);
			const { map, gl } = await shapesMap([point, shapeItem("p", plume, labelPoint(plume)!)]);
			map.focusFeature("m");
			gl.emit("moveend");
			map.focusFeature("p");
			expect(gl.moves).toHaveLength(1);
		});

		it("an ease that ended before a later map is attached doesn't carry over", async () => {
			const point = shapeItem("m", undefined, [-119.5, 36.6]);
			const { map, gl } = await shapesMap([point, shapeItem("p", plume, labelPoint(plume)!)]);
			map.focusFeature("m");
			const next = createFakeGl({ styleLoaded: true });
			map.attach(next);
			await tick();
			map.focusFeature("p");
			expect(gl.moves).toHaveLength(1);
			expect(next.moves).toEqual([]);
		});

		it("with the list panel open, the anchor is the clear part's center", async () => {
			const big = square(-125, 30, -110, 40);
			const { map, gl } = await shapesMap([shapeItem("b", big, [-117.5, 31])]);
			Object.defineProperty(gl.canvas, "clientWidth", { value: 800 });
			map.setListInset(240);
			map.focusFeature("b");
			expect(map.focusedAnchor![0]).toBeCloseTo(-119.7 + 0.15 * 5.625);
			expect(map.focusedAnchor![1]).toBeCloseTo(36.7);
			expect(gl.getCenter()).toEqual({ lng: -119.7, lat: 36.7 });
		});

		it("a shape whose label point is on screen pans as today", async () => {
			const { map, gl } = await shapesMap([
				shapeItem("s", square(-119.1, 36.9, -118.9, 37.1), [-119, 37])
			]);
			map.focusFeature("s");
			expect(gl.getCenter()).toEqual({ lng: -119, lat: 37 });
			expect(map.focusedAnchor).toEqual([-119, 37]);
		});

		it("a shape visible only under the panel eases a little", async () => {
			const west = square(-130, 36, -121.5, 37);
			const { map, gl } = await shapesMap([shapeItem("w", west, [-125.75, 36.5])]);
			Object.defineProperty(gl.canvas, "clientWidth", { value: 800 });
			map.setListInset(240);
			map.focusFeature("w");
			const { center, offset } = gl.moves.at(-1)!.options;
			expect(center[0]).toBeGreaterThan(-122.5125);
			expect(center[0]).toBeLessThan(-121.5);
			expect(center[1]).toBeCloseTo(36.5);
			expect(offset).toEqual([120, 0]);
			expect(map.focusedAnchor).toEqual(center);
		});

		it("a shape off the live view eases to its part in the settled view", async () => {
			const far = square(-100, 36, -90, 37);
			const { map, gl } = await shapesMap([shapeItem("f", far, [-95, 36.5])]);
			map.updateView(map.camera, { west: -101, south: 35, east: -98.5, north: 38 });
			map.focusFeature("f");
			expect(gl.moves.at(-1)!.options.center).toEqual([-99.75, 36.5]);
			expect(map.focusedAnchor).toEqual([-99.75, 36.5]);
		});

		it("no settled bounds and no canvas width: falls back to the label point", async () => {
			const far = square(-100, 36, -90, 37);
			const { map, gl } = await shapesMap([shapeItem("f", far, [-95, 36.5])]);
			expect(() => map.focusFeature("f")).not.toThrow();
			expect(gl.getCenter()).toEqual({ lng: -95, lat: 36.5 });
			expect(map.focusedAnchor).toEqual([-95, 36.5]);
		});

		it("a point's anchor is its lngLat", async () => {
			const { map } = await shapesMap([shapeItem("pt", undefined, [-118.5, 35.5])]);
			map.focusFeature("pt");
			expect(map.focusedAnchor).toEqual([-118.5, 35.5]);
		});

		it("focus(null) and destroy clear focusedAnchor", async () => {
			const { map } = await shapesMap([shapeItem("p", plume, labelPoint(plume)!)]);
			map.focusFeature("p");
			map.focusFeature(null);
			expect(map.focusedAnchor).toBeNull();
			map.focusFeature("p");
			map.destroy();
			expect(map.focusedAnchor).toBeNull();
		});

		it("anchorFor never moves the camera", async () => {
			const point = shapeItem("pt", undefined, [-118.5, 35.5]);
			const covering = shapeItem("p", plume, labelPoint(plume)!);
			const { map, gl } = await shapesMap([point, covering]);
			expect(map.anchorFor(covering)).toEqual([-119.7, 36.7]);
			expect(map.anchorFor(point)).toEqual([-118.5, 35.5]);
			expect(gl.moves).toEqual([]);
		});
	});

	it("destroy detaches, clears plugins, and refuses new plugins", async () => {
		const map = createMap({ config });
		const log: string[] = [];
		map.addPlugin(plugin("monitors", log), { selection: { kind: "monitors", ids: ["1"] } });
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.destroy();
		expect(map.attached).toBe(false);
		expect(log).toContain("teardown:monitors");
		expect(gl.sources.size).toBe(0);
		expect(map.plugins).toEqual([]);
		expect(map.getSelection("monitors")).toBeNull();
		expect(() => map.addPlugin(plugin("other"))).toThrow("map destroyed");
		expect(() => map.attach(createFakeGl({ styleLoaded: true }))).toThrow("map destroyed");
	});

	it("drops featureclick handlers on destroy", () => {
		const map = createMap({ config });
		const off = map.on("featureclick", vi.fn());
		map.destroy();
		expect(() => off()).not.toThrow();
		const late = map.on("featureclick", vi.fn());
		expect(() => late()).not.toThrow();
	});

	it("ignores selection changes and focus after destroy", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selectionMode: "multiple" });
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.destroy();
		map.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		map.setSelectionMode("monitors", "single");
		map.focusFeature("monitor:1");
		expect(map.getSelection("monitors")).toBeNull();
		expect(map.focusedKey).toBeNull();
		expect(gl.calls).not.toContain("easeTo");
	});

	it("doesn't make an effect depend on a previous plugin's options in addPlugin", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selectionMode: "single" });
		await tick();
		let runs = 0;
		stops.push(
			rootEffect(() => {
				runs++;
				try {
					map.addPlugin(plugin("monitors"));
				} catch {
					// A duplicate: the first plugin's state is restored.
				}
			})
		);
		flushSync();
		expect(runs).toBe(1);
		map.setSelectionMode("monitors", "multiple");
		map.setSelection("monitors", { kind: "monitors", ids: ["2"] });
		flushSync();
		expect(runs).toBe(1);
	});

	it("doesn't make an effect depend on plugin features in focusFeature", async () => {
		const map = createMap({ config });
		const names = new SvelteMap([["5", "Site 5"]]);
		map.addPlugin(
			plugin("monitors", [], {
				features: () =>
					[...names].map(([id, name]) => ({
						refKey: `monitor:${id}`,
						ref: { kind: "monitor" as const, id },
						name,
						value: null,
						level: NO_LEVEL,
						units: "",
						lngLat: [-118.5, 35.25] as [number, number],
						selectable: true
					}))
			})
		);
		await tick();
		map.attach(createFakeGl({ styleLoaded: true }));
		await tick();
		let runs = 0;
		stops.push(
			rootEffect(() => {
				runs++;
				map.focusFeature("monitor:5");
			})
		);
		flushSync();
		names.set("6", "Site 6");
		flushSync();
		expect(runs).toBe(1);
	});

	it("sets every plugin up again on themeChanged, and does nothing while detached", async () => {
		const map = createMap({ config });
		const log: string[] = [];
		map.addPlugin(plugin("monitors", log));
		await tick();
		map.addPlugin(plugin("regions", log));
		await tick();
		map.themeChanged();
		expect(log).toEqual([]);
		map.attach(createFakeGl({ styleLoaded: true }));
		await tick();
		log.length = 0;
		map.themeChanged();
		flushSync();
		expect(log.filter((l) => !l.startsWith("keys"))).toEqual([
			"teardown:monitors",
			"teardown:regions",
			"setup:monitors",
			"setup:regions"
		]);
		map.destroy();
	});
});

/** A listed monitor at a point. */
function listItem(
	id: string,
	lngLat: [number, number] = [-118.5, 35.25],
	selectable = true
): FeatureListItem {
	return {
		refKey: `monitor:${id}`,
		ref: { kind: "monitor" as const, id },
		name: `Site ${id}`,
		value: null,
		level: NO_LEVEL,
		units: "",
		lngLat,
		selectable
	};
}

describe("pickFromList", () => {
	it("applies the same selection rules as a map click: additive adds, otherwise replaces", async () => {
		const map = createMap({ config });
		const onselectionchange = vi.fn();
		map.addPlugin(
			plugin("monitors", [], { features: () => [listItem("1"), listItem("2"), listItem("3")] }),
			{ selectionMode: "multiple", onselectionchange }
		);
		await tick();
		map.pickFromList("monitors", "monitor:1", true);
		map.pickFromList("monitors", "monitor:2", true);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1", "2"] });
		map.pickFromList("monitors", "monitor:1", true);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
		map.pickFromList("monitors", "monitor:3", false);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["3"] });
		expect(onselectionchange.mock.calls.map((c) => c[0])).toEqual([
			{ kind: "monitors", ids: ["1"] },
			{ kind: "monitors", ids: ["1", "2"] },
			{ kind: "monitors", ids: ["2"] },
			{ kind: "monitors", ids: ["3"] }
		]);
	});

	it("replaces in single mode even when additive", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors", [], { features: () => [listItem("1"), listItem("2")] }), {
			selectionMode: "single",
			selection: { kind: "monitors", ids: ["1"] }
		});
		await tick();
		map.pickFromList("monitors", "monitor:2", true);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["2"] });
	});

	it("ignores items that aren't selectable, unknown refs, and plugins in none mode", async () => {
		const map = createMap({ config });
		const onselectionchange = vi.fn();
		map.addPlugin(
			plugin("monitors", [], { features: () => [listItem("1", undefined, false), listItem("2")] }),
			{ selectionMode: "multiple", onselectionchange }
		);
		await tick();
		map.addPlugin(plugin("other", [], { features: () => [listItem("2")] }), { onselectionchange });
		await tick();
		map.pickFromList("monitors", "monitor:1", false);
		map.pickFromList("monitors", "monitor:9", false);
		map.pickFromList("other", "monitor:2", false);
		map.pickFromList("missing", "monitor:2", false);
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(map.getSelection("monitors")).toBeNull();
	});

	it("fires featureclick like a map click, before the selection changes", async () => {
		const map = createMap({ config });
		const order: string[] = [];
		map.on("featureclick", (e) => {
			order.push(`click:${e.pluginId}:${JSON.stringify(e.ref)}`);
			order.push(`selection:${JSON.stringify(map.getSelection("monitors"))}`);
		});
		map.addPlugin(
			plugin("monitors", [], { features: () => [listItem("1"), listItem("2", undefined, false)] }),
			{ selectionMode: "single" }
		);
		await tick();
		map.pickFromList("monitors", "monitor:1", false);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
		// A feature that can't be selected is still clicked, as on the map.
		map.pickFromList("monitors", "monitor:2", false);
		map.pickFromList("monitors", "monitor:9", false);
		expect(order).toEqual([
			'click:monitors:{"kind":"monitor","id":"1"}',
			"selection:null",
			'click:monitors:{"kind":"monitor","id":"2"}',
			'selection:{"kind":"monitors","ids":["1"]}'
		]);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
	});
});

describe("selection mode and focus", () => {
	it("reads a plugin's selection mode reactively", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selectionMode: "single" });
		await tick();
		const seen: string[] = [];
		stops.push(rootEffect(() => void seen.push(map.getSelectionMode("monitors"))));
		flushSync();
		map.setSelectionMode("monitors", "multiple");
		flushSync();
		expect(seen).toEqual(["single", "multiple"]);
		expect(map.getSelectionMode("missing")).toBe("none");
	});

	it("pans to the named plugin's item when two plugins list the same key", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("a", [], { features: () => [listItem("1", [-118, 35])] }));
		await tick();
		map.addPlugin(plugin("b", [], { features: () => [listItem("1", [-120, 37])] }));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.focusFeature("monitor:1", "b");
		expect(gl.getCenter()).toEqual({ lng: -120, lat: 37 });
		expect(map.focusedPluginId).toBe("b");
		map.focusFeature("monitor:1");
		expect(gl.getCenter()).toEqual({ lng: -118, lat: 35 });
		expect(map.focusedPluginId).toBeNull();
		map.focusFeature("monitor:1", "b");
		map.focusFeature(null);
		expect(map.focusedKey).toBeNull();
		expect(map.focusedPluginId).toBeNull();
	});

	it("clears the focused key without moving the camera", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors", [], { features: () => [listItem("1")] }));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.focusFeature("monitor:1");
		const ease = vi.spyOn(gl, "easeTo");
		map.focusFeature(null);
		expect(map.focusedKey).toBeNull();
		expect(ease).not.toHaveBeenCalled();
	});

	it("pans without animation under reduced motion, and eases otherwise", async () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors", [], { features: () => [listItem("1")] }));
		await tick();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		const ease = vi.spyOn(gl, "easeTo");
		let reduce = true;
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: reduce && query === "(prefers-reduced-motion: reduce)"
		}));
		try {
			map.focusFeature("monitor:1");
			reduce = false;
			map.focusFeature("monitor:1");
		} finally {
			vi.unstubAllGlobals();
		}
		expect(ease.mock.calls[0][0]).toEqual({ center: [-118.5, 35.25], duration: 0 });
		expect(ease.mock.calls[1][0]).toEqual({ center: [-118.5, 35.25] });
	});
});
