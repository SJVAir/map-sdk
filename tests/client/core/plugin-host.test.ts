import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { InteractionRouter } from "../../../src/lib/core/interactions.svelte.js";
import type { MapPlugin, PluginContext, Providers } from "../../../src/lib/core/plugin.js";
import { PluginHost } from "../../../src/lib/core/plugin-host.svelte.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import type { FormatProvider } from "../../../src/lib/data/format.js";
import type { MetadataProvider } from "../../../src/lib/data/metadata.js";
import { rootEffect } from "../../fixtures/effects.svelte.js";
import { createFakeGl } from "../../fixtures/fake-gl.js";

const providers: Providers = {
	metadata: {} as MetadataProvider,
	messages: defaultMessages,
	format: {} as FormatProvider
};

function makeHost(selected = new SvelteMap<string, ReadonlySet<string>>()) {
	const router = new InteractionRouter();
	const host = new PluginHost({
		mapUid: "m1",
		providers,
		router,
		selectedKeys: (pluginId) => selected.get(pluginId) ?? new Set()
	});
	return { host, router };
}

/** A plugin that adds one source, two layers, and an image, and logs its lifecycle. */
function resourcePlugin(id: string, log: string[] = [], onSetup?: (ctx: PluginContext) => void) {
	return {
		id,
		setup(ctx) {
			log.push(`setup:${id}`);
			const source = ctx.addSource("src", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			ctx.addLayer("fill", { type: "fill", source });
			ctx.addLayer("line", { type: "line", source });
			ctx.addImage("icon", { width: 1, height: 1 } as ImageData);
			onSetup?.(ctx);
			return () => log.push(`teardown:${id}`);
		}
	} satisfies MapPlugin;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	errorSpy.mockRestore();
});

describe("PluginHost", () => {
	it("runs no setup until the style is loaded", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const gl = createFakeGl();
		host.attach(gl);
		expect(log).toEqual([]);
		gl.fireStyleLoad();
		expect(log).toEqual(["setup:a"]);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("sets up on idle when isStyleLoaded stays false, and only once", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const gl = createFakeGl();
		gl.isStyleLoaded = () => false;
		host.attach(gl);
		gl.styleLoaded = true; // addLayer works, but isStyleLoaded() still says false
		gl.emit("idle");
		expect(log).toEqual(["setup:a"]);
		expect(gl.listeners).toEqual([]);
		gl.emit("style.load");
		gl.emit("idle");
		expect(log).toEqual(["setup:a"]);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("sets up at once when the style is already loaded, and for plugins added later", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		host.add(resourcePlugin("b", log));
		expect(log).toEqual(["setup:a", "setup:b"]);
		expect(host.plugins.map((p) => p.id)).toEqual(["a", "b"]);
	});

	it("namespaces ids with the map uid and plugin id", () => {
		const { host } = makeHost();
		let ctx!: PluginContext;
		host.add(resourcePlugin("a", [], (c) => (ctx = c)));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		expect(ctx.id("x")).toBe("m1:a:x");
		expect([...gl.sources.keys()]).toEqual(["m1:a:src"]);
		expect(gl.layers.map((l) => l.id)).toEqual(["m1:a:fill", "m1:a:line"]);
		expect(gl.layers[0]).toMatchObject({ source: "m1:a:src" });
		expect([...gl.images.keys()]).toEqual(["m1:a:icon"]);
		expect(ctx.gl).toBe(gl);
		expect(ctx.metadata).toBe(providers.metadata);
		expect(ctx.messages).toBe(providers.messages);
		expect(ctx.format).toBe(providers.format);
	});

	it("removes every source, layer, image, and listener on detach, layers before sources", () => {
		const { host } = makeHost();
		const log: string[] = [];
		const listener = () => {};
		host.add(resourcePlugin("a", log, (ctx) => ctx.on("click", "m1:a:fill", listener)));
		host.add(resourcePlugin("b", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		expect(gl.listeners.some((l) => l.listener === listener)).toBe(true);
		const before = gl.calls.length;

		host.detach();

		expect(log).toEqual(["setup:a", "setup:b", "teardown:a", "teardown:b"]);
		expect(gl.sources.size).toBe(0);
		expect(gl.layers).toEqual([]);
		expect(gl.images.size).toBe(0);
		expect(gl.listeners).toEqual([]);
		const removals = gl.calls.slice(before).filter((c) => c.startsWith("remove"));
		expect(removals).toEqual([
			"removeLayer:m1:a:line",
			"removeLayer:m1:a:fill",
			"removeSource:m1:a:src",
			"removeImage:m1:a:icon",
			"removeLayer:m1:b:line",
			"removeLayer:m1:b:fill",
			"removeSource:m1:b:src",
			"removeImage:m1:b:icon"
		]);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("never touches a gl after detach", () => {
		const { host, router } = makeHost();
		let ctx!: PluginContext;
		host.add(resourcePlugin("a", [], (c) => (ctx = c)));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		host.detach();
		const register = vi.spyOn(router, "register");
		const before = gl.calls.length;
		// A plugin's late async work through its context is ignored.
		ctx.addSource("late", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
		ctx.addImage("late", { width: 1, height: 1 } as ImageData);
		ctx.addLayer("late", { type: "background" });
		ctx.on("click", "m1:a:fill", () => {});
		ctx.interactive(["m1:a:fill"], () => null);
		let effectRuns = 0;
		ctx.effect(() => {
			effectRuns++;
		});
		flushSync();
		gl.fireStyleLoad();
		gl.emit("idle");
		expect(gl.calls.length).toBe(before);
		expect(register).not.toHaveBeenCalled();
		expect(effectRuns).toBe(0);
	});

	it("detached during a style load and re-attached: sets up once on the new map only", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const oldGl = createFakeGl();
		host.attach(oldGl);
		host.detach();
		expect(oldGl.listeners).toEqual([]);
		oldGl.emit("idle");

		const newGl = createFakeGl();
		host.attach(newGl);
		oldGl.fireStyleLoad();
		expect(log).toEqual([]);
		newGl.fireStyleLoad();
		newGl.fireStyleLoad();
		expect(log).toEqual(["setup:a"]);
		expect(oldGl.sources.size + oldGl.layers.length + oldGl.images.size).toBe(0);
		expect(newGl.layers.map((l) => l.id)).toEqual(["m1:a:fill", "m1:a:line"]);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("attach replaces a previous gl, tearing down on the old one first", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const oldGl = createFakeGl({ styleLoaded: true });
		host.attach(oldGl);
		const newGl = createFakeGl({ styleLoaded: true });
		host.attach(newGl);
		expect(log).toEqual(["setup:a", "teardown:a", "setup:a"]);
		expect(oldGl.layers).toEqual([]);
		expect(newGl.layers).toHaveLength(2);
	});

	it("restyle runs teardown then setup for each plugin in order", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		host.add(resourcePlugin("b", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		log.length = 0;
		host.restyle();
		expect(log).toEqual(["teardown:a", "teardown:b", "setup:a", "setup:b"]);
		expect(gl.layers).toHaveLength(4);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("restyle after a basemap change waits for the new style and skips resources it dropped", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		log.length = 0;
		gl.setStyle({});
		host.restyle();
		expect(log).toEqual(["teardown:a"]);
		gl.fireStyleLoad();
		expect(log).toEqual(["teardown:a", "setup:a"]);
		expect(gl.layers).toHaveLength(2);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("remove tears down only that plugin", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		host.add(resourcePlugin("b", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		host.remove("a");
		expect(log).toEqual(["setup:a", "setup:b", "teardown:a"]);
		expect(gl.layers.map((l) => l.id)).toEqual(["m1:b:fill", "m1:b:line"]);
		expect(host.plugins.map((p) => p.id)).toEqual(["b"]);
	});

	it("throws on a duplicate plugin id", () => {
		const { host } = makeHost();
		host.add(resourcePlugin("a"));
		expect(() => host.add(resourcePlugin("a"))).toThrow(
			'map-sdk: a plugin with id "a" is already added'
		);
		expect(host.plugins).toHaveLength(1);
	});

	it("unregisters interactive layers on teardown", () => {
		const { host, router } = makeHost();
		const unregister = vi.fn();
		const register = vi.spyOn(router, "register").mockReturnValue(unregister);
		const toHit = () => null;
		host.add(resourcePlugin("a", [], (ctx) => ctx.interactive(["m1:a:fill"], toHit)));
		host.attach(createFakeGl({ styleLoaded: true }));
		expect(register).toHaveBeenCalledWith("a", ["m1:a:fill"], toHit);
		expect(unregister).not.toHaveBeenCalled();
		host.detach();
		expect(unregister).toHaveBeenCalledOnce();
	});

	it("exposes reactive selectedKeys and stops a plugin effect after teardown", () => {
		const selected = new SvelteMap<string, ReadonlySet<string>>();
		const { host } = makeHost(selected);
		const seen: number[] = [];
		const cleanups: string[] = [];
		host.add(
			resourcePlugin("a", [], (ctx) =>
				ctx.effect(() => {
					seen.push(ctx.selectedKeys.size);
					return () => cleanups.push("cleanup");
				})
			)
		);
		host.attach(createFakeGl({ styleLoaded: true }));
		flushSync();
		expect(seen).toEqual([0]);

		selected.set("a", new SvelteSet(["monitor:1", "monitor:2"]));
		flushSync();
		expect(seen).toEqual([0, 2]);

		host.remove("a");
		expect(cleanups).toEqual(["cleanup", "cleanup"]);
		selected.set("a", new SvelteSet(["monitor:3"]));
		flushSync();
		expect(seen).toEqual([0, 2]);
	});

	it("can be driven from inside an effect without depending on the plugin list", () => {
		const { host } = makeHost();
		const log: string[] = [];
		const gl = createFakeGl({ styleLoaded: true });
		let runs = 0;
		const stop = rootEffect(() => {
			runs++;
			host.add(resourcePlugin("a", log));
			host.attach(gl);
			host.restyle();
		});
		flushSync();
		expect(runs).toBe(1);
		expect(log).toEqual(["setup:a", "teardown:a", "setup:a"]);

		host.add(resourcePlugin("b", log));
		host.remove("b");
		flushSync();
		expect(runs).toBe(1);
		expect(log).toEqual(["setup:a", "teardown:a", "setup:a", "setup:b", "teardown:b"]);
		expect(errorSpy).not.toHaveBeenCalled();
		stop();
	});

	it("re-runs an effect reading plugins after add and remove", () => {
		const { host } = makeHost();
		const seen: string[] = [];
		const stop = rootEffect(() => {
			seen.push(host.plugins.map((p) => p.id).join(","));
		});
		flushSync();
		host.add(resourcePlugin("a"));
		flushSync();
		host.add(resourcePlugin("b"));
		flushSync();
		host.remove("a");
		flushSync();
		expect(seen).toEqual(["", "a", "a,b", "b"]);
		stop();
	});

	it("follows adds, removes, and detaches made by a plugin's setup", () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log, () => host.remove("b")));
		host.add(resourcePlugin("b", log));
		host.add(resourcePlugin("c", log, () => host.detach()));
		host.add(resourcePlugin("d", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		// c's own teardown runs as soon as its setup returns into a detached host.
		expect(log).toEqual(["setup:a", "setup:c", "teardown:a", "teardown:c"]);
		expect(gl.layers).toEqual([]);
		expect(gl.sources.size).toBe(0);
		expect(host.plugins.map((p) => p.id)).toEqual(["a", "c", "d"]);
	});

	it("tears down a plugin whose setup throws and keeps the others running", () => {
		const { host } = makeHost();
		const log: string[] = [];
		const boom = new Error("boom");
		host.add(resourcePlugin("a", log));
		host.add(
			resourcePlugin("bad", log, () => {
				throw boom;
			})
		);
		host.add(resourcePlugin("c", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);

		expect(log).toEqual(["setup:a", "setup:bad", "setup:c"]);
		expect(gl.layers.map((l) => l.id)).toEqual([
			"m1:a:fill",
			"m1:a:line",
			"m1:c:fill",
			"m1:c:line"
		]);
		expect([...gl.images.keys()]).toEqual(["m1:a:icon", "m1:c:icon"]);
		expect(errorSpy).toHaveBeenCalledOnce();
		expect(String(errorSpy.mock.calls[0][0])).toContain("bad");
		expect(errorSpy.mock.calls[0]).toContain(boom);

		host.detach();
		expect(log).toEqual(["setup:a", "setup:bad", "setup:c", "teardown:a", "teardown:c"]);
		expect(gl.layers).toEqual([]);
	});

	it("keeps tearing down when a plugin's teardown throws", () => {
		const { host } = makeHost();
		host.add({
			id: "a",
			setup(ctx) {
				ctx.addSource("s", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
				return () => {
					throw new Error("teardown failed");
				};
			}
		});
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		host.detach();
		expect(gl.sources.size).toBe(0);
		expect(String(errorSpy.mock.calls[0][0])).toContain("a");
	});

	describe("draw order", () => {
		const ids = (gl: ReturnType<typeof createFakeGl>) => gl.layers.map((l) => l.id);

		/** A plugin whose `rebuild` removes its layers directly and adds them again. */
		function rebuildingPlugin(id: string) {
			let rebuild!: () => void;
			const plugin: MapPlugin = {
				id,
				setup(ctx) {
					const source = ctx.addSource("src", {
						type: "geojson",
						data: { type: "FeatureCollection", features: [] }
					});
					const add = () => [
						ctx.addLayer("fill", { type: "fill", source }),
						ctx.addLayer("line", { type: "line", source })
					];
					let layers = add();
					rebuild = () => {
						for (const layer of layers.toReversed()) ctx.gl.removeLayer(layer);
						layers = add();
					};
					return () => {};
				}
			};
			return { plugin, rebuild: () => rebuild() };
		}

		it("draws later plugins above earlier ones", () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			expect(ids(gl)).toEqual(["m1:a:fill", "m1:a:line", "m1:b:fill", "m1:b:line"]);
		});

		it("adds a plugin before another, below its layers", () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			host.add(resourcePlugin("c"), "a");
			expect(host.plugins.map((p) => p.id)).toEqual(["c", "a", "b"]);
			expect(ids(gl)).toEqual([
				"m1:c:fill",
				"m1:c:line",
				"m1:a:fill",
				"m1:a:line",
				"m1:b:fill",
				"m1:b:line"
			]);
		});

		it("adds before a plugin whose layers aren't set up yet, in order once they are", () => {
			const { host } = makeHost();
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("c"), "a");
			const gl = createFakeGl();
			host.attach(gl);
			gl.fireStyleLoad();
			expect(ids(gl)).toEqual(["m1:c:fill", "m1:c:line", "m1:a:fill", "m1:a:line"]);
		});

		it("throws for an unknown before id", () => {
			const { host } = makeHost();
			host.add(resourcePlugin("a"));
			expect(() => host.add(resourcePlugin("b"), "nope")).toThrow(
				'map-sdk: no plugin with id "nope"'
			);
			expect(host.plugins.map((p) => p.id)).toEqual(["a"]);
			expect(() => host.move("a", "nope")).toThrow('map-sdk: no plugin with id "nope"');
		});

		it("moves a plugin to the top, or before another", () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			host.add(resourcePlugin("c"));

			host.move("a");
			expect(host.plugins.map((p) => p.id)).toEqual(["b", "c", "a"]);
			expect(ids(gl)).toEqual([
				"m1:b:fill",
				"m1:b:line",
				"m1:c:fill",
				"m1:c:line",
				"m1:a:fill",
				"m1:a:line"
			]);

			host.move("a", "c");
			expect(host.plugins.map((p) => p.id)).toEqual(["b", "a", "c"]);
			expect(ids(gl)).toEqual([
				"m1:b:fill",
				"m1:b:line",
				"m1:a:fill",
				"m1:a:line",
				"m1:c:fill",
				"m1:c:line"
			]);

			host.move("a", "a");
			host.move("missing");
			expect(host.plugins.map((p) => p.id)).toEqual(["b", "a", "c"]);
			expect(errorSpy).not.toHaveBeenCalled();
		});

		it("moves a plugin while detached, and sets up in the new order", () => {
			const { host } = makeHost();
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			host.move("a");
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			expect(ids(gl)).toEqual(["m1:b:fill", "m1:b:line", "m1:a:fill", "m1:a:line"]);
		});

		it("keeps a plugin's slot when it rebuilds its layers", () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			const a = rebuildingPlugin("a");
			host.add(a.plugin);
			host.add(resourcePlugin("b"));
			a.rebuild();
			expect(ids(gl)).toEqual(["m1:a:fill", "m1:a:line", "m1:b:fill", "m1:b:line"]);
			const before = gl.calls.length;
			host.remove("a");
			expect(gl.calls.slice(before).filter((c) => c.startsWith("removeLayer"))).toEqual([
				"removeLayer:m1:a:line",
				"removeLayer:m1:a:fill"
			]);
		});

		it("keeps the order across a restyle", () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			host.add(resourcePlugin("c"), "a");
			host.move("b", "c");
			gl.setStyle({});
			host.restyle();
			gl.fireStyleLoad();
			expect(ids(gl)).toEqual([
				"m1:b:fill",
				"m1:b:line",
				"m1:c:fill",
				"m1:c:line",
				"m1:a:fill",
				"m1:a:line"
			]);
			expect(errorSpy).not.toHaveBeenCalled();
		});

		it("keeps plugin layers above a basemap's layers", () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			gl.addLayer({ id: "basemap", type: "background" });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"), "a");
			expect(ids(gl)).toEqual(["basemap", "m1:b:fill", "m1:b:line", "m1:a:fill", "m1:a:line"]);
			host.move("b");
			expect(ids(gl)).toEqual(["basemap", "m1:a:fill", "m1:a:line", "m1:b:fill", "m1:b:line"]);
		});
	});
});
