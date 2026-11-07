import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, tick } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import type { FeatureListItem, MapPlugin, PluginContext } from "../../../src/lib/core/plugin.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";
import { rootEffect } from "../../fixtures/effects.svelte.js";
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
