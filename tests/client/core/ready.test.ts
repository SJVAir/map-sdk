import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type { MapPlugin } from "../../../src/lib/core/plugin.js";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import { createFakeGl } from "../../fixtures/fake-gl.js";

const url = (id: string) => `https://tiles.test/maps/${id}/style.json`;
const config = {
	maptilerKey: "test-key",
	basemaps: {
		styles: [
			{ id: "streets", style: url("streets") },
			{ id: "dark", style: url("dark") }
		],
		defaultId: "streets"
	}
};

function setUp(plugins: MapPlugin[] = []) {
	const map = createMap({ config });
	for (const plugin of plugins) map.addPlugin(plugin);
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	return { map, gl };
}

/** A plugin that adds a background layer, or throws from its setup. */
function layerPlugin(id: string, opts: { throws?: Error } = {}): MapPlugin {
	return {
		id,
		setup(ctx) {
			if (opts.throws) throw opts.throws;
			ctx.addLayer("bg", { type: "background" });
			return () => {};
		}
	};
}

const hasLayer = (gl: ReturnType<typeof createFakeGl>, pluginId: string) =>
	gl.layers.some((l) => l.id.endsWith(`:${pluginId}:bg`));

describe("ready", () => {
	it("is false until markReady after attach", async () => {
		const { map } = setUp();
		await tick();
		expect(map.ready).toBe(false);
		map.markReady();
		expect(map.ready).toBe(true);
	});

	it("is cleared by detach", async () => {
		const { map } = setUp();
		await tick();
		map.markReady();
		map.detach();
		expect(map.ready).toBe(false);
	});

	it("is cleared by a basemap switch until the next markReady", async () => {
		const { map, gl } = setUp();
		await tick();
		map.markReady();
		map.basemap.select("dark");
		expect(map.ready).toBe(false);
		gl.fireStyleLoad();
		expect(map.ready).toBe(false);
		map.markReady();
		expect(map.ready).toBe(true);
	});

	it("markReady after detach does nothing", () => {
		const { map } = setUp();
		map.detach();
		map.markReady();
		expect(map.ready).toBe(false);
	});

	it("gl is the attached map and null after detach", () => {
		const { map, gl } = setUp();
		expect(map.gl).toBe(gl);
		map.detach();
		expect(map.gl).toBeNull();
	});

	describe("with queued plugin setups", () => {
		it("markReady with setups queued waits for them", async () => {
			const { map, gl } = setUp([layerPlugin("p")]);
			map.markReady();
			expect(map.ready).toBe(false);
			await tick();
			expect(map.ready).toBe(true);
			expect(hasLayer(gl, "p")).toBe(true);
		});

		it("a plugin added between style load and markReady holds ready back", async () => {
			const { map, gl } = setUp();
			await tick();
			map.addPlugin(layerPlugin("p"));
			map.markReady();
			expect(map.ready).toBe(false);
			await tick();
			expect(map.ready).toBe(true);
			expect(hasLayer(gl, "p")).toBe(true);
		});

		it("adding a plugin to a ready map leaves ready true", async () => {
			const { map, gl } = setUp();
			await tick();
			map.markReady();
			expect(map.ready).toBe(true);
			map.addPlugin(layerPlugin("p"));
			expect(map.ready).toBe(true);
			await tick();
			expect(map.ready).toBe(true);
			expect(hasLayer(gl, "p")).toBe(true);
		});

		it("detach while held back clears it", async () => {
			const { map } = setUp([layerPlugin("p")]);
			map.markReady();
			map.detach();
			await tick();
			expect(map.ready).toBe(false);
		});

		it("a basemap switch while held back stays false until the next markReady", async () => {
			const { map, gl } = setUp([layerPlugin("p")]);
			map.markReady();
			map.basemap.select("dark");
			await tick();
			expect(map.ready).toBe(false);
			gl.fireStyleLoad();
			expect(map.ready).toBe(false);
			map.markReady();
			expect(map.ready).toBe(true);
		});

		it("waits for a setup queued by another plugin's setup", async () => {
			const map = createMap({ config });
			const gl = createFakeGl({ styleLoaded: true });
			const readyAtSetup: boolean[] = [];
			const other: MapPlugin = {
				id: "other",
				setup(ctx) {
					readyAtSetup.push(map.ready);
					ctx.addLayer("bg", { type: "background" });
					return () => {};
				}
			};
			map.addPlugin({
				id: "adder",
				setup() {
					map.addPlugin(other);
					return () => {};
				}
			});
			map.attach(gl);
			map.markReady();
			await tick();
			expect(readyAtSetup).toEqual([false]);
			expect(hasLayer(gl, "other")).toBe(true);
			expect(map.ready).toBe(true);
		});

		it("waits for setup on a loaded gl attached in place of another", async () => {
			const map = createMap({ config });
			map.addPlugin(layerPlugin("p"));
			map.attach(createFakeGl({ styleLoaded: true }));
			const gl = createFakeGl({ styleLoaded: true });
			map.attach(gl);
			map.markReady();
			expect(map.ready).toBe(false);
			await tick();
			expect(hasLayer(gl, "p")).toBe(true);
			expect(map.ready).toBe(true);
		});

		it("a setup that throws still lets ready turn true", async () => {
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				const { map, gl } = setUp([
					layerPlugin("bad", { throws: new Error("boom") }),
					layerPlugin("good")
				]);
				map.markReady();
				await tick();
				expect(map.ready).toBe(true);
				expect(hasLayer(gl, "good")).toBe(true);
				expect(errorSpy).toHaveBeenCalledOnce();
			} finally {
				errorSpy.mockRestore();
			}
		});
	});
});
