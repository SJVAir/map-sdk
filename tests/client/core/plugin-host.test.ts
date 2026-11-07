import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, tick } from "svelte";
import type { CustomLayerInterface } from "@maptiler/sdk";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { InteractionRouter } from "../../../src/lib/core/interactions.svelte.js";
import type { MapPlugin, PluginContext, Providers } from "../../../src/lib/core/plugin.js";
import { PluginHost } from "../../../src/lib/core/plugin-host.svelte.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import type { FormatProvider } from "../../../src/lib/data/format.js";
import type { MetadataProvider } from "../../../src/lib/data/metadata.js";
import { rootEffect } from "../../fixtures/effects.svelte.js";
import { createFakeGl } from "../../fixtures/fake-gl.js";
import { rerunnable, twoEffectPlugin } from "../../fixtures/effect-host.svelte.js";

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

/** A class instance, so its methods live on the prototype (a spread would drop them). */
class StandInLayer implements CustomLayerInterface {
	type = "custom" as const;
	removed = 0;
	constructor(public id: string) {}
	render() {}
	onAdd() {}
	onRemove() {
		this.removed++;
	}
}

/** A plugin with a custom layer between a fill and a line; `made` collects what `create` built. */
function customPlugin(id: string, made: StandInLayer[] = []) {
	return {
		id,
		setup(ctx) {
			const source = ctx.addSource("src", {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			ctx.addLayer("fill", { type: "fill", source });
			ctx.addCustomLayer("wind", (layerId) => {
				const layer = new StandInLayer(layerId);
				made.push(layer);
				return layer;
			});
			ctx.addLayer("line", { type: "line", source });
			return () => {};
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

	it("sets up at once when the style is already loaded, and for plugins added later", async () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
		host.add(resourcePlugin("b", log));
		await tick();
		expect(log).toEqual(["setup:a", "setup:b"]);
		expect(host.plugins.map((p) => p.id)).toEqual(["a", "b"]);
	});

	it("namespaces ids with the map uid and plugin id", async () => {
		const { host } = makeHost();
		let ctx!: PluginContext;
		host.add(resourcePlugin("a", [], (c) => (ctx = c)));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
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

	it("removes every source, layer, image, and listener on detach, layers before sources", async () => {
		const { host } = makeHost();
		const log: string[] = [];
		const listener = () => {};
		host.add(resourcePlugin("a", log, (ctx) => ctx.on("click", "m1:a:fill", listener)));
		host.add(resourcePlugin("b", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
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

	it("never touches a gl after detach", async () => {
		const { host, router } = makeHost();
		let ctx!: PluginContext;
		host.add(resourcePlugin("a", [], (c) => (ctx = c)));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
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

	it("attach replaces a previous gl, tearing down on the old one first", async () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const oldGl = createFakeGl({ styleLoaded: true });
		host.attach(oldGl);
		await tick();
		const newGl = createFakeGl({ styleLoaded: true });
		host.attach(newGl);
		await tick();
		expect(log).toEqual(["setup:a", "teardown:a", "setup:a"]);
		expect(oldGl.layers).toEqual([]);
		expect(newGl.layers).toHaveLength(2);
	});

	it("restyle runs teardown then setup for each plugin in order", async () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		host.add(resourcePlugin("b", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
		log.length = 0;
		host.restyle();
		expect(log).toEqual(["teardown:a", "teardown:b", "setup:a", "setup:b"]);
		expect(gl.layers).toHaveLength(4);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("restyle after a basemap change waits for the new style and skips resources it dropped", async () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
		log.length = 0;
		gl.setStyle({});
		host.restyle();
		expect(log).toEqual(["teardown:a"]);
		gl.fireStyleLoad();
		expect(log).toEqual(["teardown:a", "setup:a"]);
		expect(gl.layers).toHaveLength(2);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("remove tears down only that plugin", async () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log));
		host.add(resourcePlugin("b", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
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

	it("refuses a plugin object that is set up on another map, and allows it once released", async () => {
		const a = makeHost();
		const b = makeHost();
		const plugin = resourcePlugin("p");
		a.host.add(plugin);
		a.host.attach(createFakeGl({ styleLoaded: true }));
		b.host.attach(createFakeGl({ styleLoaded: true }));
		await tick();
		const message =
			'map-sdk: plugin "p" is already set up on another map; create one plugin per map';
		expect(() => b.host.add(plugin)).toThrow(message);
		expect(b.host.plugins).toEqual([]);

		a.host.detach();
		b.host.add(plugin);
		expect(b.host.plugins).toEqual([plugin]);
		// Map A going live again doesn't take it over: it reports and skips it.
		a.host.attach(createFakeGl({ styleLoaded: true }));
		await tick();
		expect(errorSpy).toHaveBeenCalledWith(new Error(message));
		b.host.remove("p");
		a.host.restyle();
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it("unregisters interactive layers on teardown", async () => {
		const { host, router } = makeHost();
		const unregister = vi.fn();
		const register = vi.spyOn(router, "register").mockReturnValue(unregister);
		const toHit = () => null;
		host.add(resourcePlugin("a", [], (ctx) => ctx.interactive(["m1:a:fill"], toHit)));
		host.attach(createFakeGl({ styleLoaded: true }));
		await tick();
		expect(register).toHaveBeenCalledWith("a", ["m1:a:fill"], toHit, 0);
		expect(unregister).not.toHaveBeenCalled();
		host.detach();
		expect(unregister).toHaveBeenCalledOnce();
	});

	it("exposes reactive selectedKeys and stops a plugin effect after teardown", async () => {
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
		await tick();
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

	it("can be driven from inside an effect without depending on the plugin list", async () => {
		const { host } = makeHost();
		const log: string[] = [];
		const gl = createFakeGl({ styleLoaded: true });
		let runs = 0;
		const stop = rootEffect(() => {
			runs++;
			host.add(resourcePlugin("a", log));
			host.attach(gl);
		});
		flushSync();
		await tick();
		// A second effect, so the restyle has a set-up plugin to tear down.
		let restyles = 0;
		const stopRestyle = rootEffect(() => {
			restyles++;
			host.restyle();
		});
		flushSync();
		expect(runs).toBe(1);
		expect(restyles).toBe(1);
		expect(log).toEqual(["setup:a", "teardown:a", "setup:a"]);

		host.add(resourcePlugin("b", log));
		await tick();
		host.remove("b");
		flushSync();
		expect(runs).toBe(1);
		expect(restyles).toBe(1);
		expect(log).toEqual(["setup:a", "teardown:a", "setup:a", "setup:b", "teardown:b"]);
		expect(errorSpy).not.toHaveBeenCalled();
		stop();
		stopRestyle();
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

	it("follows adds, removes, and detaches made by a plugin's setup", async () => {
		const { host } = makeHost();
		const log: string[] = [];
		host.add(resourcePlugin("a", log, () => host.remove("b")));
		host.add(resourcePlugin("b", log));
		host.add(resourcePlugin("c", log, () => host.detach()));
		host.add(resourcePlugin("d", log));
		const gl = createFakeGl({ styleLoaded: true });
		host.attach(gl);
		await tick();
		// c's own teardown runs as soon as its setup returns into a detached host.
		expect(log).toEqual(["setup:a", "setup:c", "teardown:a", "teardown:c"]);
		expect(gl.layers).toEqual([]);
		expect(gl.sources.size).toBe(0);
		expect(host.plugins.map((p) => p.id)).toEqual(["a", "c", "d"]);
	});

	it("tears down a plugin whose setup throws and keeps the others running", async () => {
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
		await tick();

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

	it("keeps tearing down when a plugin's teardown throws", async () => {
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
		await tick();
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

		it("draws later plugins above earlier ones", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			await tick();
			expect(ids(gl)).toEqual(["m1:a:fill", "m1:a:line", "m1:b:fill", "m1:b:line"]);
		});

		it("adds a plugin before another, below its layers", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			host.add(resourcePlugin("c"), "a");
			await tick();
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

		it("moves a plugin to the top, or before another", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			host.add(resourcePlugin("c"));
			await tick();

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

		it("moves a plugin while detached, and sets up in the new order", async () => {
			const { host } = makeHost();
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"));
			host.move("a");
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			await tick();
			expect(ids(gl)).toEqual(["m1:b:fill", "m1:b:line", "m1:a:fill", "m1:a:line"]);
		});

		it("keeps a plugin's slot when it rebuilds its layers", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			const a = rebuildingPlugin("a");
			host.add(a.plugin);
			host.add(resourcePlugin("b"));
			await tick();
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

		it("keeps plugin layers above a basemap's layers", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			gl.addLayer({ id: "basemap", type: "background" });
			host.attach(gl);
			host.add(resourcePlugin("a"));
			host.add(resourcePlugin("b"), "a");
			await tick();
			expect(ids(gl)).toEqual(["basemap", "m1:b:fill", "m1:b:line", "m1:a:fill", "m1:a:line"]);
			host.move("b");
			expect(ids(gl)).toEqual(["basemap", "m1:a:fill", "m1:a:line", "m1:b:fill", "m1:b:line"]);
		});

		describe("custom layers", () => {
			it("addCustomLayer adds the same object, not a copy", async () => {
				const { host } = makeHost();
				const gl = createFakeGl({ styleLoaded: true });
				host.attach(gl);
				const made: StandInLayer[] = [];
				host.add(customPlugin("a", made));
				await tick();
				expect(made).toHaveLength(1);
				expect(made[0].id).toBe("m1:a:wind");
				expect(gl.layers[1]).toBe(made[0]);
			});

			it("custom layer sits in its plugin's slot", async () => {
				const { host } = makeHost();
				const gl = createFakeGl({ styleLoaded: true });
				host.attach(gl);
				host.add(customPlugin("a"));
				host.add(resourcePlugin("b"));
				host.add(customPlugin("c"), "a");
				await tick();
				expect(ids(gl)).toEqual([
					"m1:c:fill",
					"m1:c:wind",
					"m1:c:line",
					"m1:a:fill",
					"m1:a:wind",
					"m1:a:line",
					"m1:b:fill",
					"m1:b:line"
				]);
				host.move("c");
				expect(ids(gl).slice(-3)).toEqual(["m1:c:fill", "m1:c:wind", "m1:c:line"]);
				expect(ids(gl).slice(0, 3)).toEqual(["m1:a:fill", "m1:a:wind", "m1:a:line"]);
			});

			it("custom layer is re-added after a restyle and removed once on teardown", async () => {
				const { host } = makeHost();
				const gl = createFakeGl({ styleLoaded: true });
				host.attach(gl);
				const made: StandInLayer[] = [];
				host.add(customPlugin("a", made));
				host.add(resourcePlugin("b"));
				await tick();
				gl.setStyle({});
				host.restyle();
				gl.fireStyleLoad();
				expect(made).toHaveLength(2);
				expect(ids(gl)).toEqual(["m1:a:fill", "m1:a:wind", "m1:a:line", "m1:b:fill", "m1:b:line"]);
				expect(gl.layers[1]).toBe(made[1]);
				host.detach();
				expect(gl.calls.filter((c) => c === "removeLayer:m1:a:wind")).toHaveLength(1);
				expect(ids(gl)).toEqual([]);
				expect(errorSpy).not.toHaveBeenCalled();
			});
		});
	});

	describe("setup outside the caller's effect", () => {
		it("keeps a plugin's effects running after the effect that added it re-runs", async () => {
			const { host } = makeHost();
			host.attach(createFakeGl({ styleLoaded: true }));
			await tick();
			const { plugin, runs, bump } = twoEffectPlugin("p");
			let added = false;
			const caller = rerunnable(() => {
				if (added) return;
				added = true;
				host.add(plugin);
			});
			flushSync();
			await tick();
			caller.rerun();
			flushSync();
			bump("first");
			bump("second");
			flushSync();
			bump("second");
			flushSync();
			expect(runs).toEqual({ first: 2, second: 3 });
			caller.stop();
		});

		it("defers setup of a plugin added to a live host to a microtask", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			await tick();
			const log: string[] = [];
			const plugin = resourcePlugin("a", log);
			host.add(plugin);
			expect(host.plugins).toContain(plugin);
			expect(gl.layers).toEqual([]);
			expect(host.pending).toBe(true);
			flushSync();
			expect(gl.layers).toEqual([]);
			expect(log).toEqual([]);
			await tick();
			expect(gl.layers.map((l) => l.id)).toEqual(["m1:a:fill", "m1:a:line"]);
			expect(log).toEqual(["setup:a"]);
			expect(host.pending).toBe(false);
		});

		it("defers setup when attached to an already-loaded style", async () => {
			const { host } = makeHost();
			const log: string[] = [];
			host.add(resourcePlugin("a", log));
			host.add(resourcePlugin("b", log));
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			expect(gl.layers).toEqual([]);
			expect(log).toEqual([]);
			await tick();
			expect(log).toEqual(["setup:a", "setup:b"]);
		});

		it("sets up synchronously on style.load", () => {
			const { host } = makeHost();
			const log: string[] = [];
			const gl = createFakeGl();
			host.attach(gl);
			host.add(resourcePlugin("a", log));
			gl.fireStyleLoad();
			expect(log).toEqual(["setup:a"]);
			expect(gl.layers.length).toBe(2);
			expect(host.pending).toBe(false);
		});

		it("sets up synchronously on restyle", async () => {
			const { host } = makeHost();
			const log: string[] = [];
			host.add(resourcePlugin("a", log));
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			await tick();
			host.restyle();
			expect(log).toEqual(["setup:a", "teardown:a", "setup:a"]);
			expect(gl.layers.length).toBe(2);
			expect(host.pending).toBe(false);
		});

		it("sets up a plugin re-added under the same id once", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			await tick();
			const log1: string[] = [];
			const log2: string[] = [];
			const a1 = resourcePlugin("a", log1);
			const a2 = resourcePlugin("a", log2);
			host.add(a1);
			host.remove("a");
			host.add(a2);
			await tick();
			expect(log1).toEqual([]);
			expect(log2).toEqual(["setup:a"]);
			expect(host.plugins).toEqual([a2]);
			expect(gl.layers.length).toBe(2);
		});

		it("never sets up a plugin removed before the microtask", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			await tick();
			const log: string[] = [];
			host.add(resourcePlugin("a", log));
			host.remove("a");
			await tick();
			expect(log).toEqual([]);
			expect(gl.layers).toEqual([]);
		});

		it("does nothing after detach or suspend before the microtask", async () => {
			for (const leave of ["detach", "suspend"] as const) {
				const { host } = makeHost();
				const log: string[] = [];
				host.add(resourcePlugin("a", log));
				host.add(resourcePlugin("b", log));
				const oldGl = createFakeGl({ styleLoaded: true });
				host.attach(oldGl);
				host[leave]();
				await tick();
				expect(log).toEqual([]);
				expect(oldGl.calls.filter((c) => c.startsWith("add"))).toEqual([]);
				const newGl = createFakeGl({ styleLoaded: true });
				host.attach(newGl);
				await tick();
				expect(log).toEqual(["setup:a", "setup:b"]);
				expect(newGl.layers.length).toBe(4);
				expect(oldGl.calls.filter((c) => c.startsWith("add"))).toEqual([]);
			}
		});

		it("sets up once on a loaded gl attached in place of another before the microtask", async () => {
			const { host } = makeHost();
			const log: string[] = [];
			host.add(resourcePlugin("a", log));
			const oldGl = createFakeGl({ styleLoaded: true });
			host.attach(oldGl);
			const newGl = createFakeGl({ styleLoaded: true });
			host.attach(newGl);
			await tick();
			expect(log).toEqual(["setup:a"]);
			expect(newGl.layers.length).toBe(2);
			expect(oldGl.calls.filter((c) => c.startsWith("add"))).toEqual([]);
		});

		it("sets up a plugin added by another plugin's setup", async () => {
			const { host } = makeHost();
			const gl = createFakeGl({ styleLoaded: true });
			host.attach(gl);
			await tick();
			const log: string[] = [];
			const other = resourcePlugin("other", log);
			host.add(resourcePlugin("a", log, () => host.add(other)));
			await tick();
			await tick();
			expect(log).toEqual(["setup:a", "setup:other"]);
		});

		it("refuses a plugin object queued on another live map in the same tick", async () => {
			const a = makeHost();
			const b = makeHost();
			a.host.attach(createFakeGl({ styleLoaded: true }));
			b.host.attach(createFakeGl({ styleLoaded: true }));
			await tick();
			const plugin = resourcePlugin("p");
			a.host.add(plugin);
			expect(() => b.host.add(plugin)).toThrow(
				'map-sdk: plugin "p" is already set up on another map; create one plugin per map'
			);
			expect(b.host.plugins).toEqual([]);
		});

		it("releases a queued plugin object on remove or detach before the microtask", async () => {
			for (const leave of ["remove", "detach"] as const) {
				const a = makeHost();
				const b = makeHost();
				a.host.attach(createFakeGl({ styleLoaded: true }));
				b.host.attach(createFakeGl({ styleLoaded: true }));
				await tick();
				const log: string[] = [];
				const plugin = resourcePlugin("p", log);
				a.host.add(plugin);
				if (leave === "remove") a.host.remove("p");
				else a.host.detach();
				b.host.add(plugin);
				await tick();
				expect(log).toEqual(["setup:p"]);
				expect(errorSpy).not.toHaveBeenCalled();
			}
		});

		it("calls onSettled after each queued run", async () => {
			const onSettled = vi.fn();
			const host = new PluginHost({
				mapUid: "m1",
				providers,
				router: new InteractionRouter(),
				selectedKeys: () => new Set(),
				onSettled
			});
			const gl = createFakeGl();
			host.attach(gl);
			host.add(resourcePlugin("a"));
			gl.fireStyleLoad();
			host.restyle();
			await tick();
			expect(onSettled).not.toHaveBeenCalled();
			host.add(resourcePlugin("b"));
			await tick();
			expect(onSettled).toHaveBeenCalledTimes(1);
		});
	});
});
