import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import axe from "axe-core";
import { config as maptilerConfig } from "@maptiler/sdk";
import { MapView, createMap } from "../../src/lib/index.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { GlMapLike } from "../../src/lib/core/gl.js";
import type { MapPlugin } from "../../src/lib/core/plugin.js";
import type { MetadataProvider } from "../../src/lib/data/metadata.js";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

/** A style whose one used source carries credits, the way MapTiler's styles do. */
const style = {
	version: 8,
	sources: {
		openmaptiles: {
			type: "geojson",
			data: { type: "FeatureCollection", features: [] },
			attribution:
				'<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>'
		}
	},
	layers: [{ id: "dots", type: "circle", source: "openmaptiles" }]
};

function newMap(metadata?: Partial<MetadataProvider>): MapContext {
	return createMap({
		config: {
			maptilerKey: "test-key",
			basemaps: { styles: [{ id: "a", style }], defaultId: "a" }
		},
		metadata: metadata as MetadataProvider
	});
}

function dataPlugin(dataset: string, id = "points"): MapPlugin {
	return { id, label: id, dataset, setup: () => () => {} };
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
sized.textContent =
	".narrow-map { width: 600px; height: 300px; } .wide-map { width: 800px; height: 300px; }";

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

const attrib = (root: ParentNode = document) =>
	root.querySelector<HTMLElement>(".maplibregl-ctrl-attrib");

describe("credits", () => {
	it("credits show MapTiler and OpenStreetMap text", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		await render(MapView, { map, class: "wide-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("© MapTiler"));
		expect(attrib()!.textContent).toContain("© OpenStreetMap contributors");
		expect(attrib()!.querySelector("a[href='https://www.maptiler.com/copyright/']")).not.toBeNull();
		expect(document.querySelectorAll(".maplibregl-ctrl-attrib")).toHaveLength(1);
		expect(document.querySelector(".mapsdk-credits")).toBeNull();
	});

	it("has no hand-drawn logo", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		const { container } = await render(MapView, { map, class: "wide-map" });
		await whenLoaded(attached[0]);
		expect(container.querySelector("img[src*='logo.svg']")).toBeNull();
		expect(container.querySelector("img")).toBeNull();
	});

	const shown = () => attrib()!.classList.contains("maplibregl-compact-show");
	const button = () => attrib()!.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-button")!;
	const fire = (gl: GlMapLike, type: string) =>
		(gl as unknown as { fire(type: string): void }).fire(type);

	/** A narrow map whose data credits arrive when `credits.resolve` is called. */
	async function narrowWithLateCredits() {
		const credits = Promise.withResolvers<string>();
		const map = newMap({ attribution: () => credits.promise });
		map.addPlugin(dataPlugin("air-quality"));
		const attached = trackAttach(map);
		await render(MapView, { map, class: "narrow-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()?.classList.contains("maplibregl-compact")).toBe(true));
		return { gl: attached[0], credits };
	}

	it("a narrow map starts with its credits folded", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		await render(MapView, { map, class: "narrow-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()?.classList.contains("maplibregl-compact")).toBe(true));
		await new Promise((r) => setTimeout(r, 50));
		expect(shown()).toBe(false);
		await expect.element(page.getByLabelText("Toggle attribution")).toBeVisible();
	});

	it("the credits button opens them by keyboard", async () => {
		await narrowWithLateCredits();
		button().focus();
		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() => expect(shown()).toBe(true));
		await expect.element(page.getByText("© MapTiler")).toBeVisible();
	});

	it("a credits change keeps folded credits folded", async () => {
		const { credits } = await narrowWithLateCredits();
		credits.resolve("SJVAir");
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("SJVAir"));
		await new Promise((r) => setTimeout(r, 50));
		expect(shown()).toBe(false);
	});

	it("a credits change keeps opened credits open", async () => {
		const { credits } = await narrowWithLateCredits();
		await userEvent.click(button());
		await vi.waitFor(() => expect(shown()).toBe(true));
		credits.resolve("SJVAir");
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("SJVAir"));
		await new Promise((r) => setTimeout(r, 50));
		expect(shown()).toBe(true);
		await expect.element(page.getByText(/SJVAir/)).toBeVisible();
	});

	it("a drag folds opened credits, and a later credits change keeps them folded", async () => {
		const { gl, credits } = await narrowWithLateCredits();
		await userEvent.click(button());
		await vi.waitFor(() => expect(shown()).toBe(true));
		fire(gl, "drag");
		await vi.waitFor(() => expect(shown()).toBe(false));
		credits.resolve("SJVAir");
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("SJVAir"));
		await new Promise((r) => setTimeout(r, 50));
		expect(shown()).toBe(false);
	});

	it("narrowing after load stays folded", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		await render(MapView, { map, class: "wide-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()).not.toBeNull());
		expect(attrib()!.classList.contains("maplibregl-compact")).toBe(false);
		const box = document.querySelector<HTMLElement>(".wide-map")!;
		box.classList.replace("wide-map", "narrow-map");
		(attached[0] as unknown as { resize(): void }).resize();
		await vi.waitFor(() => expect(attrib()!.classList.contains("maplibregl-compact")).toBe(true));
		await new Promise((r) => setTimeout(r, 50));
		expect(shown()).toBe(false);
	});

	it("a wide map shows the full credits line", async () => {
		const map = newMap();
		const attached = trackAttach(map);
		await render(MapView, { map, class: "wide-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()).not.toBeNull());
		expect(attrib()!.classList.contains("maplibregl-compact")).toBe(false);
	});

	it("data credits appear in the attribution, once each, in a single control", async () => {
		const attribution = vi.fn(async () => "SJVAir");
		const map = newMap({ attribution });
		map.addPlugin(dataPlugin("air-quality"));
		map.addPlugin(dataPlugin("air-quality", "other"));
		const attached = trackAttach(map);
		await render(MapView, { map, class: "wide-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("SJVAir"));
		expect(attrib()!.textContent).toContain("© MapTiler");
		expect(attrib()!.textContent!.match(/SJVAir/g)).toHaveLength(1);
		expect(document.querySelectorAll(".maplibregl-ctrl-attrib")).toHaveLength(1);
		expect(attribution).toHaveBeenCalledTimes(1);
	});

	it("shows credit text as text, not markup", async () => {
		const map = newMap({ attribution: async () => "<b>SJVAir</b>" });
		map.addPlugin(dataPlugin("air-quality"));
		const attached = trackAttach(map);
		await render(MapView, { map, class: "wide-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("<b>SJVAir</b>"));
		expect(attrib()!.querySelector("b")).toBeNull();
	});

	it("removes the control with the GL map and brings one back with it", async () => {
		const map = newMap({ attribution: async () => "SJVAir" });
		map.addPlugin(dataPlugin("air-quality"));
		const attached = trackAttach(map);
		const { rerender, unmount } = await render(MapView, { map, class: "wide-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("SJVAir"));
		await rerender({ active: false });
		expect(document.querySelector(".maplibregl-ctrl-attrib")).toBeNull();
		await rerender({ active: true });
		await whenLoaded(attached[1]);
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("SJVAir"));
		expect(document.querySelectorAll(".maplibregl-ctrl-attrib")).toHaveLength(1);
		await unmount();
		expect(document.querySelector(".maplibregl-ctrl-attrib")).toBeNull();
	});

	it("has no axe violations in the credits", async () => {
		const map = newMap({ attribution: async () => "SJVAir" });
		map.addPlugin(dataPlugin("air-quality"));
		const attached = trackAttach(map);
		await render(MapView, { map, class: "wide-map" });
		await whenLoaded(attached[0]);
		await vi.waitFor(() => expect(attrib()?.textContent).toContain("SJVAir"));
		const result = await axe.run(attrib()!.parentElement!);
		expect(result.violations).toEqual([]);
	});
});
