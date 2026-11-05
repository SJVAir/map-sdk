import { flushSync } from "svelte";
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

function setUp(interval: MetadataProvider["monitorTypeInterval"] | null) {
	const base = createDefaultMetadata();
	const metadata: MetadataProvider = { ...base };
	if (interval) metadata.monitorTypeInterval = interval;
	else delete metadata.monitorTypeInterval;
	const source = new TestSource({
		features: points([monitor("1", "purpleair", 12), monitor("2", "airnow", 20)]),
		scale: pm25Scale
	});
	const plugin = monitorsPlugin({ source, layerLabel: "Monitors", clustered: false });
	const map = createMap({ config: { maptilerKey: "test-key" }, metadata });
	map.addPlugin(plugin);
	map.attach(createFakeGl({ styleLoaded: true }));
	flushSync();
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
		const { open } = setUp(lookup);
		open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
		expect(text()).not.toContain("avg)");
		resolve("2 min");
		await expect.poll(text).toContain("(2 min avg)");
	});

	it("never leaves an empty card for a provider that never settles", async () => {
		const { open } = setUp(() => new Promise<string>(() => {}));
		open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
	});

	it("looks a type up once and shares it between tooltips", async () => {
		const lookup = vi.fn(async () => "2 min");
		const { open } = setUp(lookup);
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
		const { open } = setUp(lookup);
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
		const { open } = setUp(null);
		open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
		expect(text()).not.toContain("avg)");
	});

	it("does not update a tooltip that closed before the lookup resolved", async () => {
		let resolve!: (value: string) => void;
		const { open } = setUp(() => new Promise<string>((r) => (resolve = r)));
		const view = await open();
		await expect.element(page.getByText("Monitor 1")).toBeVisible();
		view.unmount();
		resolve("2 min");
		await new Promise((r) => setTimeout(r, 50));
		expect(text()).not.toContain("avg)");
	});
});
