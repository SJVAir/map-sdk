import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { cdp, page, userEvent } from "vitest/browser";
import axe from "axe-core";
import { config as maptilerConfig } from "@maptiler/sdk";
import { createMap, maptilerMap } from "../../src/lib/index.js";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { OptionGroup, OptionRow } from "../../src/lib/options/types.js";
import MapViewWithToolbar from "../fixtures/MapViewWithToolbar.svelte";
import MapViewInRoot from "../fixtures/MapViewInRoot.svelte";
import { ToolbarState } from "../fixtures/options.svelte.js";
import { parkPointer } from "./park-pointer.js";

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
	".phone-map { width: 390px; height: 700px; }",
	".short-map { width: 1000px; height: 220px; }",
	".mid-map { width: 800px; height: 400px; }",
	".root-1024 { width: 1024px; height: 500px; }",
	".root-600 { width: 600px; height: 400px; }",
	".map-683 { width: 683px; height: 500px; flex: none; }",
	".map-600 { width: 600px; height: 400px; flex: none; }"
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
	await parkPointer();
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

async function setup(
	props: {
		class?: string;
		featureList?: unknown;
		withToolbar?: boolean;
		searchWidth?: string;
		controls?: "mapsdk" | "engine" | "none";
	} = {}
) {
	const state = new ToolbarState({ groups: groups(), values: { pollutant: "pm25" } });
	const map = newMap();
	const screen = await render(MapViewWithToolbar, { map, state, ...props } as never);
	const root = () => document.querySelector<HTMLElement>(".mapsdk-map")!;
	// The layout follows the map's width a frame later.
	await settle();
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

	it("the bar stops 0.5rem short of the controls at top-right, or 1rem from the edge without", async () => {
		const barRight = () =>
			document.querySelector("[data-mapsdk-toolbar-bar]")!.getBoundingClientRect().right;
		await setup();
		const zoom = document.querySelector(".mapsdk-zoom")!.getBoundingClientRect();
		await vi.waitFor(() => expect(barRight()).toBeCloseTo(zoom.left - 8, 1));

		document.body.replaceChildren();
		const engine = await setup({ controls: "engine" });
		// The SDK adds its controls once the style loads; the bar follows.
		const corner = () =>
			engine.root().querySelector(".maplibregl-ctrl-top-right")!.getBoundingClientRect();
		await vi.waitFor(() => expect(corner().width).toBeGreaterThan(0), { timeout: 5000 });
		await vi.waitFor(() => expect(barRight()).toBeCloseTo(corner().left - 8, 1));

		document.body.replaceChildren();
		await setup({ controls: "none" });
		await vi.waitFor(() =>
			expect(barRight()).toBeCloseTo(
				document.querySelector(".mapsdk-map")!.getBoundingClientRect().right - 16,
				1
			)
		);
	});

	it("with the engine's controls, the bar keeps 4rem until they're drawn, not 1rem", async () => {
		// A style that never loads (fetch is offline here): the engine never adds its controls.
		const map = createMap({
			config: {
				maptilerKey: "test-key",
				basemaps: {
					styles: [{ id: "a", style: "https://tiles.invalid/style.json" }],
					defaultId: "a"
				}
			}
		});
		const state = new ToolbarState({ groups: groups(), values: { pollutant: "pm25" } });
		await render(MapViewWithToolbar, { map, state, controls: "engine" } as never);
		await settle();
		await new Promise((r) => setTimeout(r, 300));
		const box = document.querySelector(".mapsdk-map")!.getBoundingClientRect();
		const bar = document.querySelector("[data-mapsdk-toolbar-bar]")!.getBoundingClientRect();
		expect(bar.right).toBeCloseTo(box.right - 64, 1);
	});

	it("stops short of a host's own control in the engine's corner, beside map-sdk's buttons", async () => {
		const { map } = await setup();
		await vi.waitFor(() => expect(maptilerMap(map)).toBeTruthy());
		const wide = document.createElement("div");
		wide.className = "maplibregl-ctrl";
		wide.style.cssText = "width: 120px; height: 30px";
		maptilerMap(map)!.addControl({ onAdd: () => wide, onRemove: () => wide.remove() }, "top-right");
		const bar = () =>
			document.querySelector("[data-mapsdk-toolbar-bar]")!.getBoundingClientRect().right;
		await vi.waitFor(() => expect(bar()).toBeCloseTo(wide.getBoundingClientRect().left - 8, 1));
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
		// Its section headers keep 0.75rem of side padding (the wide row's triggers have 0.625rem).
		expect(getComputedStyle(trigger("Layers").element()).paddingLeft).toBe("12px");
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
		// Off the toolbar: otherwise Monitors comes back under the pointer and opens on hover.
		await parkPointer();
		root().style.width = "300px";
		await settle();
		await expect.element(page.getByRole("button", { name: "Open map options" })).toBeVisible();
		expect(
			page.getByRole("button", { name: "Open map options" }).element().getAttribute("aria-expanded")
		).toBe("false");
		root().style.width = "1000px";
		await settle();
		// Long enough for Chromium's pointer events after a layout change.
		await new Promise((r) => setTimeout(r, 300));
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

	it("two maps: Esc with focus in one closes the dropdown a mouse shows in the other", async () => {
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
		// WCAG 1.4.13: a dropdown the mouse shows closes on Esc wherever focus is.
		expect(monitors.nth(1).element().getAttribute("aria-expanded")).toBe("false");
		expect(monitors.nth(0).element().getAttribute("aria-expanded")).toBe("false");
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

describe("OptionsToolbar search slot", () => {
	const slot = () => document.querySelector<HTMLElement>(".mapsdk-options-search")!;
	const bar = () => document.querySelector<HTMLElement>("[data-mapsdk-toolbar-bar]")!;
	const field = () => document.querySelector<HTMLElement>("[data-test-search]")!;
	const openButton = () => document.querySelector<HTMLElement>(".mapsdk-options-open")!;

	it("the narrow search slot fills the bar beside the options button", async () => {
		await setup({ class: "phone-map", searchWidth: "100%" });
		await vi.waitFor(() => expect(slot()).not.toBeNull());
		const room = bar().getBoundingClientRect().width - openButton().getBoundingClientRect().width;
		expect(slot().getBoundingClientRect().width).toBeCloseTo(room - 8, 0);
		expect(slot().getBoundingClientRect().top).toBe(openButton().getBoundingClientRect().top);
	});

	it("a full-width field caps at the room left", async () => {
		await setup({ class: "phone-map", searchWidth: "100%" });
		await vi.waitFor(() => expect(field()).not.toBeNull());
		const width = field().getBoundingClientRect().width;
		expect(width).toBeCloseTo(slot().getBoundingClientRect().width, 0);
		expect(width).toBeLessThan(302);
	});

	it("the slot's empty part lets the pointer through", async () => {
		await setup({ class: "phone-map", searchWidth: "4rem" });
		await vi.waitFor(() => expect(field()).not.toBeNull());
		const box = slot().getBoundingClientRect();
		const hit = document.elementFromPoint(box.right - 4, box.top + box.height / 2)!;
		expect(slot().contains(hit)).toBe(false);
		const own = field().getBoundingClientRect();
		expect(document.elementFromPoint(own.left + 4, own.top + own.height / 2)).toBe(field());
	});

	it("the wide bar's search slot is unchanged", async () => {
		await setup({ searchWidth: "10rem" });
		await vi.waitFor(() => expect(slot()).not.toBeNull());
		expect(getComputedStyle(slot()).flexGrow).toBe("0");
		expect(getComputedStyle(slot()).pointerEvents).toBe("auto");
	});
});

describe("OptionsToolbar narrow panel, final review fixes", () => {
	it("the panel is a region named by its title", async () => {
		await setup({ class: "narrow-map" });
		await page.getByRole("button", { name: "Open map options" }).click();
		await expect.element(page.getByRole("region", { name: "Map Options" })).toBeVisible();
	});
});

describe("OptionsToolbar measuring", () => {
	it("crossing to narrow and back raises no ResizeObserver loop error", async () => {
		const errors: string[] = [];
		const onerror = (e: ErrorEvent) => errors.push(e.message);
		window.addEventListener("error", onerror);
		try {
			const { root } = await setup();
			for (const width of ["500px", "1000px", "300px", "900px"]) {
				root().style.width = width;
				await settle();
				await settle();
			}
			await page.viewport(500, 900);
			await settle();
			await settle();
		} finally {
			await page.viewport(1400, 900);
			window.removeEventListener("error", onerror);
		}
		expect(errors.filter((m) => /ResizeObserver/.test(m))).toEqual([]);
	});
});

describe("layoutRoot", () => {
	async function inRoot(props: Record<string, unknown> = {}) {
		const state = new ToolbarState({ groups: groups(), values: { pollutant: "pm25" } });
		const screen = await render(MapViewInRoot, { map: newMap(), state, ...props } as never);
		await settle();
		await settle();
		const shell = () => document.querySelector<HTMLElement>(".layout-root")!;
		const mapBox = () => document.querySelector<HTMLElement>(".mapsdk-map")!;
		return { screen, shell, mapBox };
	}
	const openButton = () => page.getByRole("button", { name: "Open map options" });
	const isWide = () => !!trigger("Monitors").query() && !openButton().query();
	const isNarrow = () => !trigger("Monitors").query() && !!openButton().query();

	it("a 1024px root keeps a 683px map's toolbar wide", async () => {
		const { mapBox } = await inRoot();
		expect(mapBox().getBoundingClientRect().width).toBe(683);
		expect(isWide()).toBe(true);
	});

	/**
	 * Monitor-map's toolbar: two clusters of icon-and-label triggers and the icon-only Settings,
	 * with a 40px search button. Each label is pinned to its width in monitor-map (its triggers
	 * measured 119/135/121/136/44px there), so the row is the app's whatever this browser's font.
	 */
	async function appToolbar() {
		const icon = { svg: "<svg viewBox='0 0 16 16'><circle cx='8' cy='8' r='6'/></svg>" };
		const rows = many(1);
		const app: OptionGroup[] = [
			{ id: "pollutant", label: "PM2.5", icon, cluster: "monitors", rows },
			{ id: "monitors", label: "Monitors", icon, cluster: "monitors", rows },
			{ id: "layers", label: "Layers", icon, cluster: "options", rows },
			{ id: "overlays", label: "Overlays", icon, cluster: "options", align: "end", rows },
			{ id: "settings", label: "Settings", icon, cluster: "options", iconOnly: true, rows }
		];
		const state = new ToolbarState({ groups: app, values: {} });
		await render(MapViewInRoot, { map: newMap(), state, searchButton: true } as never);
		await settle();
		await settle();
		const labels = [43, 59, 45, 60];
		// The app's borders (each cluster's 1px edge and divider) take their room here too.
		const shell = document.querySelector<HTMLElement>(".layout-root")!;
		shell.style.setProperty("--border", "#e5e5e5");
		shell.style.setProperty("--card-border", "#d4d4d4");
		const triggers = [...document.querySelectorAll<HTMLElement>(".mapsdk-options-trigger")];
		triggers.slice(0, 4).forEach((t, i) => {
			const label = t.querySelector<HTMLElement>(":scope > span:nth-of-type(2)")!;
			label.style.cssText = `display: inline-block; width: ${labels[i]}px; flex: none`;
		});
		await settle();
		const search = document.querySelector<HTMLElement>("[data-test-search]")!;
		return { triggers, search };
	}

	it("monitor-map's row and its search button fit one row of a 683px map", async () => {
		const { triggers, search } = await appToolbar();
		expect(isWide()).toBe(true);
		// On the first row: level with the first cluster (its trigger sits inside a 1px border).
		const cluster = triggers[0].closest(".mapsdk-options-cluster")!;
		expect(search.getBoundingClientRect().top).toBe(cluster.getBoundingClientRect().top);
		// With room to spare, so a slightly wider label or font doesn't wrap it.
		const bar = document.querySelector("[data-mapsdk-toolbar-bar]")!.getBoundingClientRect();
		expect(bar.right - search.getBoundingClientRect().right).toBeGreaterThanOrEqual(8);
		// Every trigger stays a full target (WCAG 2.5.8's 24×24 and then some); icon-only is square.
		for (const t of triggers) {
			const r = t.getBoundingClientRect();
			expect(r.height).toBe(40);
			expect(r.width).toBeGreaterThanOrEqual(40);
		}
		expect(triggers[4].getBoundingClientRect().width).toBe(40);
	});

	it("without it, the same 683px map goes narrow, as before", async () => {
		await inRoot({ useRoot: false });
		expect(isNarrow()).toBe(true);
	});

	it("a root under 48rem goes narrow (phones: the panel stacks under the map)", async () => {
		await inRoot({ rootClass: "root-600", mapClass: "map-600" });
		expect(isNarrow()).toBe(true);
	});

	it("null root: back to the map's own box", async () => {
		const { screen } = await inRoot();
		expect(isWide()).toBe(true);
		await screen.rerender({ useRoot: false });
		await settle();
		await settle();
		expect(isNarrow()).toBe(true);
	});

	it("follows the root's resize, not the map's", async () => {
		const { shell, mapBox } = await inRoot();
		shell().style.width = "600px";
		await settle();
		await settle();
		expect(isNarrow()).toBe(true);
		shell().style.width = "1024px";
		await settle();
		await settle();
		expect(mapBox().getBoundingClientRect().width).toBe(683);
		expect(isWide()).toBe(true);
	});

	it("swapped root: follows the new element", async () => {
		const { screen } = await inRoot();
		await screen.rerender({ altRoot: true });
		await settle();
		await settle();
		expect(isNarrow()).toBe(true);
		await screen.rerender({ altRoot: false });
		await settle();
		await settle();
		expect(isWide()).toBe(true);
	});

	it("root crossing 48rem raises no ResizeObserver loop error", async () => {
		const errors: string[] = [];
		const onerror = (e: ErrorEvent) => errors.push(e.message);
		window.addEventListener("error", onerror);
		try {
			const { shell } = await inRoot();
			for (const width of ["600px", "1024px", "700px", "1100px"]) {
				shell().style.width = width;
				await settle();
				await settle();
			}
		} finally {
			window.removeEventListener("error", onerror);
		}
		expect(errors.filter((m) => /ResizeObserver/.test(m))).toEqual([]);
	});

	it("a zero-width root counts as wide", async () => {
		const { shell, mapBox } = await inRoot();
		shell().style.width = "0px";
		shell().style.overflow = "visible";
		await settle();
		await settle();
		expect(mapBox().getBoundingClientRect().width).toBe(683);
		expect(isWide()).toBe(true);
	});

	it("a root element that unmounts: back to the map's own box", async () => {
		const { screen } = await inRoot({ altRoot: true, altClass: "root-1024" });
		expect(isWide()).toBe(true);
		const errors: string[] = [];
		const onerror = (e: ErrorEvent) => errors.push(e.message);
		window.addEventListener("error", onerror);
		try {
			await screen.rerender({ altShown: false });
			await settle();
			await settle();
		} finally {
			window.removeEventListener("error", onerror);
		}
		expect(document.querySelector(".alt-root")).toBeNull();
		expect(isNarrow()).toBe(true);
		expect(errors).toEqual([]);
	});

	it("two maps under one root decide on their own", async () => {
		await inRoot({ secondMap: newMap() });
		const maps = [...document.querySelectorAll<HTMLElement>(".mapsdk-map")];
		expect(maps).toHaveLength(2);
		const options = (el: HTMLElement) => el.querySelector("[aria-label='Open map options']");
		// The first map has the root (1024px): wide. The second has none, so its own 683px: narrow.
		expect(options(maps[0])).toBeNull();
		expect(options(maps[1])).not.toBeNull();
	});

	it("an open dropdown stays inside the 683px map", async () => {
		const { mapBox } = await inRoot();
		for (const name of ["Settings", "Monitors"]) {
			await trigger(name).click();
			await settle();
			const body = document.querySelector<HTMLElement>(
				`#${CSS.escape(trigger(name).element().getAttribute("aria-controls")!)} > div`
			)!;
			const box = body.getBoundingClientRect();
			const map = mapBox().getBoundingClientRect();
			expect(box.left).toBeGreaterThanOrEqual(map.left);
			expect(box.right).toBeLessThanOrEqual(map.right);
			await userEvent.keyboard("{Escape}");
		}
	});
});

describe("OptionsToolbar child rows line up with their parent", () => {
	const dot = {
		svg: '<svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>'
	};
	const aligned = (): OptionGroup[] => [
		{
			id: "monitors",
			label: "Monitors",
			rows: [
				{
					kind: "group",
					id: "ref",
					label: "Reference-grade",
					icon: dot,
					children: [
						{ kind: "checkbox", id: "airnow", label: "AirNow" },
						{ kind: "checkbox", id: "bam", label: "BAM 1022" }
					]
				},
				{
					kind: "checkbox",
					id: "ev",
					label: "EV Chargers",
					children: [
						{
							kind: "checkbox",
							id: "ev2",
							label: "Level 2",
							children: [{ kind: "checkbox", id: "ev2fast", label: "Fast" }]
						}
					]
				}
			]
		}
	];

	async function open(layout: "wide" | "narrow") {
		const state = new ToolbarState({
			groups: aligned(),
			values: { airnow: true, bam: true, ev: true, ev2: true, ev2fast: false }
		});
		const props = layout === "narrow" ? { class: "narrow-map" } : {};
		await render(MapViewWithToolbar, { map: newMap(), state, ...props } as never);
		await settle();
		if (layout === "narrow") {
			await page.getByRole("button", { name: "Open map options" }).click();
			await slid();
		}
		await trigger("Monitors").click();
	}

	const rowOf = (label: string) =>
		page.getByText(label, { exact: true }).element().closest("label")!;
	const box = (el: Element) => el.getBoundingClientRect();
	const centreX = (el: Element) => box(el).left + box(el).width / 2;
	const input = (label: string) => rowOf(label).querySelector("input")!;
	const icon = (label: string) => rowOf(label).querySelector(".mapsdk-option-icon")!;
	const text = (label: string) => rowOf(label).querySelector(".mapsdk-option-label")!;
	const childrenOf = (label: string) => rowOf(label).nextElementSibling!;

	for (const layout of ["wide", "narrow"] as const) {
		it(`${layout}: a child's checkbox is centred under the parent's icon`, async () => {
			await open(layout);
			for (const child of ["AirNow", "BAM 1022"]) {
				expect(
					Math.abs(centreX(input(child)) - centreX(icon("Reference-grade")))
				).toBeLessThanOrEqual(0.5);
			}
		});

		it(`${layout}: under a parent with no icon, a child's checkbox starts at the parent's label`, async () => {
			await open(layout);
			expect(
				Math.abs(box(input("Level 2")).left - box(text("EV Chargers")).left)
			).toBeLessThanOrEqual(0.5);
			expect(Math.abs(box(input("Fast")).left - box(text("Level 2")).left)).toBeLessThanOrEqual(
				0.5
			);
		});

		it(`${layout}: the guide line is a border, so a hovered row's background doesn't cover it`, async () => {
			await open(layout);
			// The test page sets no --border: the line still takes its 1px, so the alignment holds.
			for (const parent of ["Reference-grade", "EV Chargers", "Level 2"]) {
				const style = getComputedStyle(childrenOf(parent));
				expect(style.borderLeftWidth).toBe("1px");
				expect(style.borderLeftStyle).toBe("solid");
			}
		});

		it(`${layout}: the guide line stays under the parent's checkbox`, async () => {
			await open(layout);
			for (const parent of ["Reference-grade", "EV Chargers", "Level 2"]) {
				expect(Math.abs(box(childrenOf(parent)).left - centreX(input(parent)))).toBeLessThanOrEqual(
					1
				);
			}
		});
	}
});
