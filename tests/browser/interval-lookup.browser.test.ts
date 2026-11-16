import { tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import type { MetadataProvider } from "../../src/lib/data/metadata.js";
import { createDefaultMetadata } from "../../src/lib/data/metadata.js";
import { monitorsPlugin } from "../../src/lib/presets/monitors.js";
import { createFakeGl } from "../fixtures/fake-gl.js";
import { monitor } from "../fixtures/monitors.js";
import { pm25Scale } from "../fixtures/scales.js";
import { points, TestSource } from "../fixtures/sources.svelte.js";
import SnippetHost from "../fixtures/SnippetHost.svelte";

const errors = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
	expect(errors).not.toHaveBeenCalled();
	errors.mockClear();
});

async function setUp(
	interval: MetadataProvider["monitorTypeInterval"] | null,
	extra: Partial<Parameters<typeof monitorsPlugin>[0]> = {}
) {
	const base = createDefaultMetadata();
	const metadata: MetadataProvider = { ...base };
	if (interval) metadata.monitorTypeInterval = interval;
	else delete metadata.monitorTypeInterval;
	const source = new TestSource({
		features: points([
			monitor("1", "purpleair", 12),
			monitor("2", "airnow", 20),
			monitor("3", "airnow", null)
		]),
		scale: pm25Scale
	});
	const plugin = monitorsPlugin({
		source,
		layerLabel: "Monitors",
		clustered: false,
		...extra
	});
	const map = createMap({ config: { maptilerKey: "test-key" }, metadata });
	map.addPlugin(plugin);
	map.attach(createFakeGl({ styleLoaded: true }));
	await tick();
	const items = plugin.features!();
	const open = (index = 0) => {
		const snippet = plugin.tooltip!(items[index])!;
		return render(SnippetHost, { snippet });
	};
	return { open, map };
}

const text = () => document.body.textContent!.replace(/\s+/g, " ");

describe("the tooltips' interval lookup", () => {
	it("shows the card at once and adds the note when the lookup resolves", async () => {
		let resolve!: (value: string) => void;
		const lookup = vi.fn(() => new Promise<string>((r) => (resolve = r)));
		const { open } = await setUp(lookup);
		open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
		expect(text()).not.toContain("avg)");
		resolve("2 min");
		await expect.poll(text).toContain("(2 min avg)");
	});

	it("never leaves an empty card for a provider that never settles", async () => {
		const { open } = await setUp(() => new Promise<string>(() => {}));
		open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
	});

	it("looks a type up once and shares it between tooltips", async () => {
		const lookup = vi.fn(async () => "2 min");
		const { open } = await setUp(lookup);
		open(0);
		await expect.poll(text).toContain("(2 min avg)");
		open(0);
		await expect.poll(() => text().match(/\(2 min avg\)/g)?.length).toBe(2);
		expect(lookup).toHaveBeenCalledTimes(1);
	});

	it("retries after a failure, and a synchronous throw shows the card without a note", async () => {
		const lookup = vi
			.fn<NonNullable<MetadataProvider["monitorTypeInterval"]>>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockImplementationOnce(() => {
				throw new Error("sync");
			})
			.mockResolvedValue("1 hour");
		const { open } = await setUp(lookup);
		open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
		await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
		expect(text()).not.toContain("avg)");
		open();
		await expect.poll(() => lookup.mock.calls.length).toBe(2);
		expect(text()).not.toContain("avg)");
		open();
		await expect.poll(text).toContain("(1 hour avg)");
		expect(lookup).toHaveBeenCalledTimes(3);
	});

	it("leaves the note out for a provider without the method", async () => {
		const { open } = await setUp(null);
		open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
		expect(text()).not.toContain("avg)");
	});

	it("does not update a tooltip that closed before the lookup resolved", async () => {
		let resolve!: (value: string) => void;
		const { open } = await setUp(() => new Promise<string>((r) => (resolve = r)));
		const view = await open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
		view.unmount();
		resolve("2 min");
		await new Promise((r) => setTimeout(r, 50));
		expect(text()).not.toContain("avg)");
	});

	it("a blank figure label keeps the interval line", async () => {
		const { open } = await setUp(async () => "1 hour", { figureLabel: "  " });
		open();
		await expect.poll(text).toContain("(1 hour avg)");
	});

	it("names the figure in a cluster's tooltip too", async () => {
		const source = new TestSource({
			features: points([monitor("1", "purpleair", 12), monitor("2", "purpleair", 20)]),
			scale: pm25Scale
		});
		const plugin = monitorsPlugin({
			source,
			layerLabel: "Monitors",
			figureLabel: "24-hour average"
		});
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(plugin);
		const gl = createFakeGl({ styleLoaded: true });
		const getSource = gl.getSource.bind(gl);
		gl.getSource = (id: string) => {
			const found = getSource(id) as object | undefined;
			return found && { ...found, getClusterLeaves: () => new Promise(() => {}) };
		};
		map.attach(gl);
		await tick();
		const layer = `${map.uid}:monitors:cluster-icon:purpleair`;
		gl.setRenderedFeatures([
			{
				layer: { id: layer },
				source: "",
				properties: { cluster: true, cluster_id: 7, point_count: 2, sumValues: 32, countValues: 2 },
				geometry: { type: "Point", coordinates: [-119.5, 36.5] }
			}
		]);
		gl.emit("mousemove", { point: { x: 1, y: 2 }, lngLat: { lng: -119.5, lat: 36.5 } });
		render(SnippetHost, { snippet: plugin.hoverTooltip!(map.hovered!.hit)! });
		await expect.element(page.getByText("24-hour average")).toBeVisible();
		expect(text()).toContain("(cluster avg)");
	});
});

describe("monitorsPlugin's tooltip options", () => {
	it("shows the detail for a monitor with no level", async () => {
		const { open } = await setUp(null, { detail: () => "Not enough data" });
		open(2);
		await expect.element(page.getByText("Not enough data")).toBeVisible();
		expect(text()).not.toContain("No level");
	});

	it("shows the figure label in place of the interval line", async () => {
		const lookup = vi.fn(async () => "1 hour");
		const { open } = await setUp(lookup, { figureLabel: "24-hour average" });
		open();
		await expect.element(page.getByText("24-hour average")).toBeVisible();
		await new Promise((r) => setTimeout(r, 50));
		expect(text()).not.toContain("avg)");
		expect(lookup).not.toHaveBeenCalled();
	});
});
