import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { cdp, page, userEvent } from "vitest/browser";
import axe from "axe-core";
import { config as maptilerConfig } from "@maptiler/sdk";
import { createMap } from "../../src/lib/index.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { OptionGroup, OptionRow } from "../../src/lib/options/types.js";
import MapViewWithToolbar from "../fixtures/MapViewWithToolbar.svelte";
import { ToolbarState } from "../fixtures/options.svelte.js";

vi.mock("esm-env", () => ({ BROWSER: true, DEV: true, NODE: false }));

const style = {
	version: 8,
	sources: { base: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
	layers: [{ id: "dots", type: "circle", source: "base" }]
};

const sized = document.createElement("style");
sized.textContent = [
	".wide-map { width: 1000px; height: 500px; }",
	".narrow-map { width: 300px; height: 400px; }",
	".short-map { width: 1000px; height: 220px; }",
	".mid-map { width: 800px; height: 400px; }"
].join("\n");

const EXPECTED_WARNINGS = [
	/^MapTiler Cloud API key is not set/,
	/^\[webglcontextlost\] .* harmless/
];
const warn = console.warn.bind(console);
vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
	if (!EXPECTED_WARNINGS.some((re) => re.test(args.map(String).join(" ")))) warn(...args);
});

beforeAll(async () => {
	maptilerConfig.telemetry = false;
	document.head.append(sized);
	await page.viewport(1400, 900);
	vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("offline")));
});

afterEach(async () => {
	document.body.replaceChildren();
	await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

afterAll(() => {
	sized.remove();
});

function newMap(): MapContext {
	return createMap({
		config: { maptilerKey: "test-key", basemaps: { styles: [{ id: "a", style }], defaultId: "a" } }
	});
}

const many = (n: number): OptionRow[] =>
	Array.from({ length: n }, (_, i) => ({ kind: "checkbox", id: `r${i}`, label: `Row ${i}` }));

function groups(): OptionGroup[] {
	return [
		{
			id: "pollutant",
			label: "PM2.5",
			rows: [
				{
					kind: "radio",
					id: "pollutant",
					closesMenu: true,
					choices: [
						{ value: "pm25", label: "PM2.5" },
						{ value: "o3", label: "Ozone" }
					]
				}
			]
		},
		{ id: "monitors", label: "Monitors", cluster: "main", rows: many(14) },
		{ id: "layers", label: "Layers", cluster: "main", rows: many(2) },
		{
			id: "settings",
			label: "Settings",
			cluster: "main",
			iconOnly: true,
			align: "end",
			rows: many(2)
		}
	];
}

async function setup(props: { class?: string; featureList?: unknown; withToolbar?: boolean } = {}) {
	const state = new ToolbarState({ groups: groups(), values: { pollutant: "pm25" } });
	const map = newMap();
	const screen = await render(MapViewWithToolbar, { map, state, ...props } as never);
	const root = () => document.querySelector<HTMLElement>(".mapsdk-map")!;
	return { state, map, screen, root };
}

const trigger = (name: string) => page.getByRole("button", { name, exact: true });
const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
/** Past the panel's 200 ms slide. */
const slid = () => new Promise((r) => setTimeout(r, 260));

describe("OptionsToolbar in MapView", () => {
	it("a 1000px map shows the row of triggers; a 300px map the options button", async () => {
		await setup();
		await expect.element(trigger("Monitors")).toBeVisible();
		expect(document.querySelector("[aria-label='Open map options']")).toBeNull();
		document.body.replaceChildren();
		await setup({ class: "narrow-map" });
		await expect.element(page.getByRole("button", { name: "Open map options" })).toBeVisible();
		expect(trigger("Monitors").query()).toBeNull();
	});

	it("the narrow panel: a titled panel over the map, sections, a close button", async () => {
		const { state, root } = await setup({ class: "narrow-map" });
		const open = page.getByRole("button", { name: "Open map options" });
		expect(open.element().getAttribute("aria-expanded")).toBe("false");
		await open.click();
		expect(open.element().getAttribute("aria-expanded")).toBe("true");
		const panel = document.getElementById(open.element().getAttribute("aria-controls")!)!;
		await expect.element(page.getByText("Map Options")).toBeVisible();
		await slid();
		const box = panel.getBoundingClientRect();
		const map = root().getBoundingClientRect();
		expect([box.left, box.top, box.width, box.height]).toEqual([
			map.left,
			map.top,
			map.width,
			map.height
		]);
		// Several sections at once; picking a radio keeps its section open.
		await trigger("PM2.5").click();
		await trigger("Layers").click();
		expect(trigger("PM2.5").element().getAttribute("aria-expanded")).toBe("true");
		expect(trigger("Layers").element().getAttribute("aria-expanded")).toBe("true");
		await page.getByRole("radio", { name: "Ozone" }).click();
		expect(state.calls.at(-1)?.changed).toEqual(["pollutant"]);
		expect(trigger("PM2.5").element().getAttribute("aria-expanded")).toBe("true");
		// The close button closes it and hands focus back to the options button.
		await page.getByRole("button", { name: "Close map options" }).click();
		expect(open.element().getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(open.element());
	});

	it("Esc closes the narrow panel and returns focus to the options button", async () => {
		await setup({ class: "narrow-map" });
		const open = page.getByRole("button", { name: "Open map options" });
		await open.click();
		await trigger("Layers").click();
		await userEvent.keyboard("{Escape}");
		expect(open.element().getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(open.element());
	});

	it("crossing 48rem closes everything", async () => {
		const { root } = await setup();
		await trigger("Monitors").click();
		root().style.width = "300px";
		await settle();
		await expect.element(page.getByRole("button", { name: "Open map options" })).toBeVisible();
		expect(
			page.getByRole("button", { name: "Open map options" }).element().getAttribute("aria-expanded")
		).toBe("false");
		root().style.width = "1000px";
		await settle();
		await expect.element(trigger("Monitors")).toBeVisible();
		expect(trigger("Monitors").element().getAttribute("aria-expanded")).toBe("false");
	});

	it("a dropdown taller than the room below its trigger is capped inside the map and scrolls", async () => {
		const { root } = await setup({ class: "short-map" });
		await trigger("Monitors").click();
		await settle();
		const body = document.querySelector<HTMLElement>(
			`#${CSS.escape(trigger("Monitors").element().getAttribute("aria-controls")!)} > div`
		)!;
		expect(body.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			root().getBoundingClientRect().bottom
		);
		expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
	});

	it("a start-aligned dropdown that would cross the map's right edge aligns to its end", async () => {
		const state = new ToolbarState({
			groups: [
				{
					id: "long",
					label: "A very long group label that pushes the next one right",
					rows: many(1)
				},
				{ id: "last", label: "Last", rows: many(2) }
			],
			values: {}
		});
		await render(MapViewWithToolbar, { map: newMap(), state, class: "mid-map" } as never);
		await trigger("Last").click();
		await settle();
		const dropdown = document.getElementById(
			trigger("Last").element().getAttribute("aria-controls")!
		)!;
		const map = document.querySelector(".mapsdk-map")!.getBoundingClientRect();
		expect(dropdown.getBoundingClientRect().right).toBeLessThanOrEqual(map.right);
		expect(dropdown.getBoundingClientRect().left).toBeGreaterThanOrEqual(map.left);
	});

	it("the narrow panel sits above the feature list and the card", async () => {
		const { root } = await setup({ class: "narrow-map" });
		await page.getByRole("button", { name: "Open map options" }).click();
		await slid();
		const map = root().getBoundingClientRect();
		const hit = document.elementFromPoint(map.left + 40, map.top + 40)!;
		expect(hit.closest(".mapsdk-options-panel")).not.toBeNull();
	});

	it("the focus-revealed List button shows below the toolbar when tabbed to", async () => {
		await setup({ featureList: { reveal: "focus" } });
		const list = page.getByRole("button", { name: /list/i });
		(list.element() as HTMLElement).focus();
		await settle();
		const bar = document.querySelector("[data-mapsdk-toolbar-bar]")!.getBoundingClientRect();
		expect(list.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(bar.bottom);
	});

	it("sets --mapsdk-toolbar-height to the bar's bottom, and nothing without a toolbar", async () => {
		const { root } = await setup();
		await settle();
		const bar = document.querySelector("[data-mapsdk-toolbar-bar]")!.getBoundingClientRect();
		const expected = Math.round(bar.bottom - root().getBoundingClientRect().top);
		expect(root().style.getPropertyValue("--mapsdk-toolbar-height")).toBe(`${expected}px`);
		document.body.replaceChildren();
		const again = await setup({ withToolbar: false });
		await settle();
		expect(again.root().style.getPropertyValue("--mapsdk-toolbar-height")).toBe("");
		expect(document.querySelector(".mapsdk-toolbar-slot")).toBeNull();
	});

	it("two maps: Esc in one leaves the other's open dropdown alone", async () => {
		await setup();
		await setup();
		const monitors = page.getByRole("button", { name: "Monitors", exact: true });
		// Shown by a mouse over it, so focus can be in the other map without closing it.
		monitors
			.nth(1)
			.element()
			.parentElement!.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
		await settle();
		expect(monitors.nth(1).element().getAttribute("aria-expanded")).toBe("true");
		(
			page.getByRole("button", { name: "Layers", exact: true }).nth(0).element() as HTMLElement
		).focus();
		await userEvent.keyboard("{Escape}");
		expect(monitors.nth(1).element().getAttribute("aria-expanded")).toBe("true");
	});

	it("the panel slides only without reduced motion", async () => {
		await setup({ class: "narrow-map" });
		const panel = () => document.querySelector<HTMLElement>(".mapsdk-options-panel")!;
		expect(getComputedStyle(panel()).transitionDuration).not.toBe("0s");
		await cdp().send("Emulation.setEmulatedMedia", {
			features: [{ name: "prefers-reduced-motion", value: "reduce" }]
		});
		expect(getComputedStyle(panel()).transitionDuration).toBe("0s");
	});

	it("has no axe violations in either layout", async () => {
		await setup();
		await trigger("Monitors").click();
		let result = await axe.run(document.querySelector(".mapsdk-toolbar-slot")!);
		expect(result.violations).toEqual([]);
		document.body.replaceChildren();
		await setup({ class: "narrow-map" });
		await page.getByRole("button", { name: "Open map options" }).click();
		await trigger("Monitors").click();
		result = await axe.run(document.querySelector(".mapsdk-toolbar-slot")!);
		expect(result.violations).toEqual([]);
	});
});

describe("OptionsToolbar in MapView, review fixes", () => {
	it("measures a toolbar the host shows after mount, and follows the bar's size", async () => {
		const state = new ToolbarState({ groups: groups(), values: { pollutant: "pm25" } });
		state.shown = false;
		await render(MapViewWithToolbar, { map: newMap(), state, class: "mid-map" } as never);
		const root = document.querySelector<HTMLElement>(".mapsdk-map")!;
		await settle();
		expect(root.style.getPropertyValue("--mapsdk-toolbar-height")).toBe("");
		state.shown = true;
		await vi.waitFor(() =>
			expect(root.style.getPropertyValue("--mapsdk-toolbar-height")).not.toBe("")
		);
		const before = parseFloat(root.style.getPropertyValue("--mapsdk-toolbar-height"));
		// Labels long enough to wrap the bar onto a second line.
		state.groups = groups().map((g) => ({ ...g, label: `${g.label} with a much longer label` }));
		await vi.waitFor(() =>
			expect(parseFloat(root.style.getPropertyValue("--mapsdk-toolbar-height"))).toBeGreaterThan(
				before
			)
		);
	});

	it("while the narrow panel is open, Tab can't reach the controls it covers", async () => {
		await setup({ class: "narrow-map" });
		await page.getByRole("button", { name: "Open map options" }).click();
		await slid();
		const map = document.querySelector<HTMLElement>(".mapsdk-map")!;
		const list = map.querySelector(".mapsdk-list-panel")!;
		expect(list.closest("[inert]")).not.toBeNull();
		await page.getByRole("button", { name: "Close map options" }).click();
		expect(list.closest("[inert]")).toBeNull();
	});
});
