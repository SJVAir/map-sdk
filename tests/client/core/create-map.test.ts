import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import type { MapPlugin, PluginContext } from "../../../src/lib/core/plugin.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
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

	it("keeps two maps apart", () => {
		const a = createMap({ config });
		const b = createMap({ config });
		expect(a.uid).not.toBe(b.uid);

		a.addPlugin(plugin("monitors"), { selectionMode: "multiple" });
		expect(a.plugins.map((p) => p.id)).toEqual(["monitors"]);
		expect(b.plugins).toEqual([]);

		b.addPlugin(plugin("monitors"));
		a.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		expect(a.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
		expect(b.getSelection("monitors")).toBeNull();

		const glA = createFakeGl({ styleLoaded: true });
		const glB = createFakeGl({ styleLoaded: true });
		a.attach(glA);
		b.attach(glB);
		expect([...glA.sources.keys()]).toEqual([`${a.uid}:monitors:src`]);
		expect([...glB.sources.keys()]).toEqual([`${b.uid}:monitors:src`]);
	});

	it("keeps selection and camera across detach and attach, and sets plugins up again", () => {
		const map = createMap({ config });
		const log: string[] = [];
		map.addPlugin(plugin("monitors", log), { selectionMode: "single" });
		const first = createFakeGl({ styleLoaded: true });
		map.attach(first);
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
		flushSync();
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["7"] });
		expect(map.camera).toEqual(camera);
		expect(map.bounds).toEqual(bounds);
		expect(log).toEqual(["setup:monitors", "keys:monitors:monitor:7"]);
		expect([...second.sources.keys()]).toEqual([`${map.uid}:monitors:src`]);
	});

	it("gives each plugin its own selection, reactively, through selectedKeys", () => {
		const map = createMap({ config });
		const log: string[] = [];
		map.addPlugin(plugin("monitors", log), {
			selectionMode: "multiple",
			selection: { kind: "monitors", ids: ["1"] }
		});
		map.addPlugin(plugin("regions", log));
		map.attach(createFakeGl({ styleLoaded: true }));
		flushSync();
		expect(log).toContain("keys:monitors:monitor:1");
		expect(log).toContain("keys:regions:");

		log.length = 0;
		map.setSelection("regions", { kind: "regions", ids: ["county:019"] });
		flushSync();
		expect(log).toEqual(["keys:regions:region:county:019"]);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
	});

	it("keeps selected ids that are not in any data", () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selectionMode: "multiple" });
		map.attach(createFakeGl({ styleLoaded: true }));
		map.setSelection("monitors", { kind: "monitors", ids: ["no-such-1", "no-such-2"] });
		flushSync();
		expect(map.getSelection("monitors")).toEqual({
			kind: "monitors",
			ids: ["no-such-1", "no-such-2"]
		});
	});

	it("does not call onselectionchange when the host sets the selection", () => {
		const map = createMap({ config });
		const onselectionchange = vi.fn();
		map.addPlugin(plugin("monitors"), { selectionMode: "single", onselectionchange });
		map.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		map.setSelection("monitors", null);
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(map.getSelection("monitors")).toBeNull();
	});

	it("makes getSelection reactive", () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"));
		const seen: Array<string[] | null> = [];
		stops.push(rootEffect(() => seen.push(map.getSelection("monitors")?.ids ?? null)));
		flushSync();
		map.setSelection("monitors", { kind: "monitors", ids: ["3"] });
		flushSync();
		expect(seen).toEqual([null, ["3"]]);
	});

	it("drops a plugin's selection when it is removed", () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selection: { kind: "monitors", ids: ["1"] } });
		map.removePlugin("monitors");
		expect(map.plugins).toEqual([]);
		expect(map.getSelection("monitors")).toBeNull();
	});

	it("leaves the first plugin's selection alone when a duplicate id is added", () => {
		const map = createMap({ config });
		map.addPlugin(plugin("monitors"), { selection: { kind: "monitors", ids: ["1"] } });
		expect(() =>
			map.addPlugin(plugin("monitors"), { selection: { kind: "monitors", ids: ["2"] } })
		).toThrow(/already added/);
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["1"] });
	});

	it("focuses a feature: marks it and pans to it", () => {
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
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		map.focusFeature("monitor:5");
		expect(map.focusedKey).toBe("monitor:5");
		expect(gl.getCenter()).toEqual({ lng: -118.5, lat: 35.25 });
	});

	it("returns no hits until interactions are wired", () => {
		const map = createMap({ config });
		expect(map.featuresAt({ x: 1, y: 2 })).toEqual([]);
		expect(map.featureForElement({} as Element)).toBeNull();
	});

	it("destroy detaches, clears plugins, and refuses new plugins", () => {
		const map = createMap({ config });
		const log: string[] = [];
		map.addPlugin(plugin("monitors", log), { selection: { kind: "monitors", ids: ["1"] } });
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
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
		// Firing is wired in Task 10; here, registering and unsubscribing stay safe after destroy.
		const map = createMap({ config });
		const off = map.on("featureclick", vi.fn());
		map.destroy();
		expect(() => off()).not.toThrow();
		const late = map.on("featureclick", vi.fn());
		expect(() => late()).not.toThrow();
	});
});
