import { describe, expect, it } from "vitest";
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

function setUp() {
	const map = createMap({ config });
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	return { map, gl };
}

describe("ready", () => {
	it("is false until markReady after attach", () => {
		const { map } = setUp();
		expect(map.ready).toBe(false);
		map.markReady();
		expect(map.ready).toBe(true);
	});

	it("is cleared by detach", () => {
		const { map } = setUp();
		map.markReady();
		map.detach();
		expect(map.ready).toBe(false);
	});

	it("is cleared by a basemap switch until the next markReady", () => {
		const { map, gl } = setUp();
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
});
