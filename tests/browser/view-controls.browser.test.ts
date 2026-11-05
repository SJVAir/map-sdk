import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap } from "../../src/lib/index.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

const style = {
	version: 8,
	sources: {
		base: {
			type: "geojson",
			data: { type: "FeatureCollection", features: [] },
			attribution: "&copy; MapTiler &copy; OpenStreetMap contributors"
		}
	},
	layers: [{ id: "dots", type: "circle", source: "base" }]
};

function newMap(): MapContext {
	const map = createMap({
		config: {
			maptilerKey: "test-key",
			basemaps: { styles: [{ id: "a", style }], defaultId: "a" }
		}
	});
	map.addPlugin(
		{ id: "monitors", label: "monitors", setup: () => () => {} },
		{ selectionMode: "single", selection: { kind: "monitors", ids: ["1"] } }
	);
	return map;
}

function trackAttach(map: MapContext): GlMapLike[] {
	const attached: GlMapLike[] = [];
	const attach = map.attach.bind(map);
	vi.spyOn(map, "attach").mockImplementation((gl) => {
		attached.push(gl);
		attach(gl);
	});
	return attached;
}

function whenLoaded(gl: GlMapLike): Promise<void> {
	return new Promise((resolve) => {
		if ((gl as unknown as { loaded(): boolean }).loaded()) resolve();
		else gl.on("load", () => resolve());
	});
}

const sized = document.createElement("style");
sized.textContent = ".view-map { width: 800px; height: 300px; }";
const requests: string[] = [];
const EXPECTED_WARNINGS = [
	/^MapTiler Cloud API key is not set/,
	/^\[webglcontextlost\] .* harmless/
];
const warn = console.warn.bind(console);
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	if (!EXPECTED_WARNINGS.some((re) => re.test(args.map(String).join(" ")))) warn(...args);
});

beforeAll(() => {
	maptilerConfig.telemetry = false;
	document.head.append(sized);
	vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
		requests.push(input instanceof Request ? input.url : String(input));
		return Promise.reject(new TypeError("offline"));
	});
});

afterEach(() => {
	document.body.replaceChildren();
});

afterAll(() => {
	expect(requests).toEqual([]);
});

const q = (selector: string) => document.querySelectorAll(selector);

async function show(props: Record<string, unknown> = {}) {
	const map = newMap();
	const attached = trackAttach(map);
	const view = await render(MapView, { map, class: "view-map", ...props });
	await whenLoaded(attached[0]);
	return { map, attached, view };
}

describe("MapView controls", () => {
	it("selectionBar false leaves the bar out with a selection set", async () => {
		await show();
		await vi.waitFor(() => expect(q(".mapsdk-selection")).toHaveLength(1));
		document.body.replaceChildren();
		await show({ selectionBar: false });
		expect(q(".mapsdk-selection")).toHaveLength(0);
	});

	it("default still shows mapsdk zoom buttons", async () => {
		await show();
		expect(q(".mapsdk-zoom button")).toHaveLength(2);
		expect(q(".maplibregl-ctrl-compass")).toHaveLength(0);
		expect(q(".maplibregl-ctrl-geolocate")).toHaveLength(0);
	});

	it("controls engine shows the compass and locate buttons and not mapsdk zoom buttons", async () => {
		await show({ controls: "engine" });
		expect(q(".maplibregl-ctrl-top-right .maplibregl-ctrl-compass")).toHaveLength(1);
		expect(q(".maplibregl-ctrl-top-right .maplibregl-ctrl-geolocate")).toHaveLength(1);
		expect(q(".maplibregl-ctrl-zoom-in")).toHaveLength(1);
		expect(q(".mapsdk-zoom")).toHaveLength(0);
		await vi.waitFor(() => expect(q(".maplibregl-ctrl-attrib")).toHaveLength(1));
	});

	it("controls none shows no zoom buttons and keeps the credits", async () => {
		await show({ controls: "none" });
		expect(q(".mapsdk-zoom")).toHaveLength(0);
		expect(q(".maplibregl-ctrl-compass")).toHaveLength(0);
		expect(q(".maplibregl-ctrl-geolocate")).toHaveLength(0);
		await vi.waitFor(() => expect(q(".maplibregl-ctrl-attrib")).toHaveLength(1));
	});

	it("engine controls are not duplicated when active toggles", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		const view = await render(MapView, { map, class: "view-map", controls: "engine" });
		await whenLoaded(attached[0]);
		await view.rerender({ active: false });
		await view.rerender({ active: true });
		await whenLoaded(attached[1]);
		expect(q(".maplibregl-ctrl-compass")).toHaveLength(1);
		expect(q(".maplibregl-ctrl-geolocate")).toHaveLength(1);
	});
});
