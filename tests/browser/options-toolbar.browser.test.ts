import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import axe from "axe-core";
import { createMap, type MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { OptionGroup } from "../../src/lib/options/types.js";
import OptionsToolbarHost from "../fixtures/OptionsToolbarHost.svelte";
import { ToolbarState } from "../fixtures/options.svelte.js";
import { createFakeGl } from "../fixtures/fake-gl.js";
import { settingsGroup } from "../../src/lib/options/presets.js";

const newMap = (): MapContext => createMap({ config: { maptilerKey: "test-key" } });

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
						{ value: "pm25", label: "PM2.5", unit: "µg/m³", help: "Fine particles." },
						{ value: "o3", label: "Ozone", unit: "ppb" }
					]
				}
			]
		},
		{
			id: "monitors",
			label: "Monitors",
			cluster: "main",
			rows: [
				{
					kind: "group",
					id: "low-cost",
					label: "Low-cost sensors",
					children: [
						{ kind: "checkbox", id: "type:purpleair", label: "PurpleAir" },
						{ kind: "checkbox", id: "type:airgradient", label: "AirGradient" }
					]
				},
				{ kind: "separator", id: "sep" },
				{ kind: "checkbox", id: "inactive", label: "Inactive" }
			]
		},
		{
			id: "layers",
			label: "Layers",
			cluster: "main",
			rows: [
				{
					kind: "checkbox",
					id: "ev",
					label: "EV Chargers",
					children: [{ kind: "checkbox", id: "ev2", label: "Level 2" }]
				}
			]
		},
		{
			id: "settings",
			label: "Settings",
			cluster: "main",
			iconOnly: true,
			align: "end",
			rows: [
				{ kind: "checkbox", id: "clustered", label: "Marker Clusters" },
				{
					kind: "select",
					id: "basemap",
					label: "Basemap",
					choices: [
						{ value: "streets-v4", label: "Streets", matches: ["streets-v4-dark"] },
						{ value: "outdoor-v4", label: "Outdoor" }
					]
				},
				{ kind: "reset", id: "reset", label: "Reset Map Options" }
			]
		}
	];
}

const values = () => ({
	pollutant: "pm25",
	"type:purpleair": true,
	"type:airgradient": false,
	inactive: false,
	ev: false,
	ev2: true,
	clustered: true,
	basemap: "streets-v4"
});

async function setup(extra: Partial<ConstructorParameters<typeof ToolbarState>[0]> = {}) {
	const state = new ToolbarState({ groups: groups(), values: values(), ...extra });
	const map = newMap();
	await render(OptionsToolbarHost, { map, state });
	return { state, map };
}

const trigger = (name: string) => page.getByRole("button", { name, exact: true });
const expanded = (name: string) => trigger(name).element().getAttribute("aria-expanded");
const panelOf = (name: string) =>
	document.getElementById(trigger(name).element().getAttribute("aria-controls")!)!;
const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;

afterEach(() => {
	document.body.replaceChildren();
});

describe("OptionsToolbar, wide", () => {
	it("is a labelled group of disclosure buttons", async () => {
		await setup();
		const root = page.getByRole("group", { name: "Map options" }).element();
		expect(root).toBeTruthy();
		for (const name of ["PM2.5", "Monitors", "Layers", "Settings"]) {
			expect(expanded(name)).toBe("false");
			expect(panelOf(name)).toBeTruthy();
		}
	});

	it("opens one dropdown at a time; a click toggles", async () => {
		await setup();
		await trigger("Monitors").click();
		expect(expanded("Monitors")).toBe("true");
		expect(visible(panelOf("Monitors"))).toBe(true);
		await trigger("Layers").click();
		expect(expanded("Monitors")).toBe("false");
		expect(expanded("Layers")).toBe("true");
		await trigger("Layers").click();
		expect(expanded("Layers")).toBe("false");
	});

	it("hovering another trigger with a mouse closes a click-opened dropdown", async () => {
		await setup();
		await trigger("Monitors").click();
		await trigger("Layers").hover();
		expect(expanded("Monitors")).toBe("false");
		expect(expanded("Layers")).toBe("true");
	});

	it("a touch pointer entering a trigger opens nothing", async () => {
		await setup();
		const menu = trigger("Layers").element().parentElement!;
		menu.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
		await Promise.resolve();
		expect(expanded("Layers")).toBe("false");
	});

	it("closes on an outside click", async () => {
		await setup();
		await trigger("Monitors").click();
		await page.getByTestId("outside").click();
		expect(expanded("Monitors")).toBe("false");
	});

	it("closes when focus leaves it, and Esc returns focus to the trigger", async () => {
		await setup();
		await trigger("Monitors").click();
		page.getByRole("checkbox", { name: "Inactive" }).element().focus();
		await userEvent.keyboard("{Escape}");
		expect(expanded("Monitors")).toBe("false");
		expect(document.activeElement).toBe(trigger("Monitors").element());
		await trigger("Monitors").click();
		(page.getByTestId("outside").element() as HTMLElement).tabIndex = 0;
		(page.getByTestId("outside").element() as HTMLElement).focus();
		await Promise.resolve();
		expect(expanded("Monitors")).toBe("false");
	});

	it("picking a radio with closesMenu sends one change and closes the dropdown", async () => {
		const { state } = await setup();
		await trigger("PM2.5").click();
		await page.getByRole("radio", { name: /Ozone/ }).click();
		expect(state.calls).toEqual([
			{ values: { ...values(), pollutant: "o3" }, changed: ["pollutant"] }
		]);
		expect(expanded("PM2.5")).toBe("false");
	});

	it("shows a radio's unit and help", async () => {
		await setup();
		await trigger("PM2.5").click();
		expect(panelOf("PM2.5").textContent).toContain("µg/m³");
		expect(panelOf("PM2.5").textContent).toContain("Fine particles.");
	});

	it("a select-all on a partly checked group is one change naming every flipped child", async () => {
		const { state } = await setup();
		await trigger("Monitors").click();
		const all = page
			.getByRole("checkbox", { name: "Low-cost sensors" })
			.element() as HTMLInputElement;
		expect(all.indeterminate).toBe(true);
		await page.getByRole("checkbox", { name: "Low-cost sensors" }).click();
		expect(state.calls).toHaveLength(1);
		expect(state.calls[0].changed).toEqual(["type:airgradient"]);
		expect(all.checked).toBe(true);
		expect(all.indeterminate).toBe(false);
	});

	it("shows a checkbox's children only while it is on", async () => {
		const { state } = await setup();
		await trigger("Layers").click();
		expect(document.body.textContent).not.toContain("Level 2");
		await page.getByRole("checkbox", { name: "EV Chargers" }).click();
		expect(state.calls[0].changed).toEqual(["ev"]);
		await expect.element(page.getByRole("checkbox", { name: "Level 2" })).toBeInTheDocument();
	});

	it("a select shows the choice matching the value, and a pick is one change", async () => {
		const { state } = await setup({ values: { ...values(), basemap: "streets-v4-dark" } });
		await trigger("Settings").click();
		const select = page.getByRole("combobox", { name: "Basemap" }).element() as HTMLSelectElement;
		expect(select.selectedOptions[0].textContent?.trim()).toBe("Streets");
		await page.getByRole("combobox", { name: "Basemap" }).selectOptions("outdoor-v4");
		expect(state.calls).toEqual([
			{ values: { ...values(), basemap: "outdoor-v4" }, changed: ["basemap"] }
		]);
	});

	it("reset is one change to the defaults, and absent without defaults", async () => {
		const { state } = await setup({
			values: { ...values(), clustered: false, basemap: "outdoor-v4" },
			defaults: { clustered: true, basemap: "streets-v4" }
		});
		await trigger("Settings").click();
		await page.getByRole("button", { name: "Reset Map Options" }).click();
		expect(state.calls).toEqual([{ values: values(), changed: ["clustered", "basemap"] }]);
		document.body.replaceChildren();
		await setup();
		await trigger("Settings").click();
		expect(document.body.textContent).not.toContain("Reset Map Options");
	});

	it("values set by the host update the inputs and fire nothing", async () => {
		const { state } = await setup();
		await trigger("Monitors").click();
		state.values = { ...values(), inactive: true };
		await expect.element(page.getByRole("checkbox", { name: "Inactive" })).toBeChecked();
		expect(state.calls).toEqual([]);
	});

	it("read-only: rows stay focusable with aria-disabled, triggers open, nothing changes", async () => {
		const { state } = await setup();
		state.readonly = true;
		await trigger("Monitors").click();
		const inactive = page.getByRole("checkbox", { name: "Inactive" });
		expect(inactive.element().getAttribute("aria-disabled")).toBe("true");
		expect((inactive.element() as HTMLInputElement).disabled).toBe(false);
		// Playwright won't click an aria-disabled control, so these clicks go to the elements.
		(inactive.element() as HTMLInputElement).click();
		expect((inactive.element() as HTMLInputElement).checked).toBe(false);
		(page.getByRole("checkbox", { name: "Low-cost sensors" }).element() as HTMLElement).click();
		await trigger("Settings").click();
		const select = page.getByRole("combobox", { name: "Basemap" }).element() as HTMLSelectElement;
		select.value = "outdoor-v4";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		expect(select.value).toBe("streets-v4");
		expect(state.calls).toEqual([]);
	});

	it("new groups keep the open menu open and focus on its row", async () => {
		const { state } = await setup();
		await trigger("Monitors").click();
		page.getByRole("checkbox", { name: "Inactive" }).element().focus();
		state.groups = groups().map((g) => (g.id === "monitors" ? { ...g, label: "Monitors" } : g));
		await Promise.resolve();
		expect(expanded("Monitors")).toBe("true");
		expect(document.activeElement).toBe(page.getByRole("checkbox", { name: "Inactive" }).element());
	});

	it("a focused row removed by new groups hands focus to its trigger, menu still open", async () => {
		const { state } = await setup();
		await trigger("Monitors").click();
		page.getByRole("checkbox", { name: "Inactive" }).element().focus();
		state.groups = groups().map((g) =>
			g.id === "monitors" ? { ...g, rows: g.rows.filter((r) => r.id !== "inactive") } : g
		);
		await new Promise((r) => setTimeout(r, 0));
		expect(expanded("Monitors")).toBe("true");
		expect(document.activeElement).toBe(trigger("Monitors").element());
	});

	it("a disabled group's trigger is disabled", async () => {
		const state = new ToolbarState({
			groups: groups().map((g) => (g.id === "monitors" ? { ...g, disabled: true } : g)),
			values: values()
		});
		await render(OptionsToolbarHost, { map: newMap(), state });
		expect((trigger("Monitors").element() as HTMLButtonElement).disabled).toBe(true);
	});

	it("an iconOnly trigger keeps its name for screen readers; align end anchors right", async () => {
		await setup();
		const settings = trigger("Settings").element();
		expect(settings.textContent?.includes("Settings")).toBe(true);
		await trigger("Settings").click();
		const panel = panelOf("Settings").getBoundingClientRect();
		const box = settings.getBoundingClientRect();
		expect(Math.round(panel.right)).toBe(Math.round(box.right));
	});

	it("two toolbars never share ids or an open menu", async () => {
		await setup();
		await setup();
		const triggers = page.getByRole("button", { name: "Monitors", exact: true }).elements();
		expect(triggers).toHaveLength(2);
		const ids = triggers.map((t) => t.getAttribute("aria-controls"));
		expect(new Set(ids).size).toBe(2);
		await page.getByRole("button", { name: "Monitors", exact: true }).nth(0).click();
		await userEvent.keyboard("{Escape}");
		await page.getByRole("button", { name: "Monitors", exact: true }).nth(1).click();
		expect(triggers[1].getAttribute("aria-expanded")).toBe("true");
		(page.getByTestId("outside").nth(0).element() as HTMLElement).click();
		await Promise.resolve();
		expect(triggers[1].getAttribute("aria-expanded")).toBe("false");
	});

	it("has no axe violations with a dropdown open", async () => {
		await setup();
		await trigger("Monitors").click();
		const result = await axe.run(page.getByRole("group", { name: "Map options" }).element());
		expect(result.violations).toEqual([]);
	});
});

describe("OptionsToolbar, basemap rows", () => {
	const url = (id: string) => `https://tiles.test/maps/${id}/style.json`;
	const basemapMap = () =>
		createMap({
			config: {
				maptilerKey: "k",
				basemaps: {
					styles: [
						{
							id: "streets-v4",
							style: url("streets-v4"),
							basemap: "Streets",
							name: "Default",
							isDefault: true
						},
						{
							id: "streets-v4-dark",
							style: url("streets-v4-dark"),
							basemap: "Streets",
							name: "Dark"
						},
						{
							id: "outdoor-v4",
							style: url("outdoor-v4"),
							basemap: "Outdoor",
							name: "Default",
							isDefault: true
						}
					],
					defaultId: "streets-v4"
				}
			}
		});

	async function basemapSetup() {
		const map = basemapMap();
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		const settings = settingsGroup(map, { clusters: false, reset: false });
		const state = new ToolbarState({ groups: settings.groups, values: { ...settings.defaults } });
		state.basemapKey = "basemap";
		await render(OptionsToolbarHost, { map, state });
		await trigger("Settings").click();
		return { map, gl, state };
	}

	const shownBasemap = () =>
		(page.getByRole("combobox", { name: "Basemap" }).element() as HTMLSelectElement).value;

	it("a failed style sends no change, and the rows show what the map fell back to", async () => {
		const { map, gl, state } = await basemapSetup();
		map.basemap.select("outdoor-v4");
		await expect.poll(shownBasemap).toBe("outdoor-v4");
		gl.emit("error", { error: { url: url("outdoor-v4") } });
		await expect.poll(shownBasemap).toBe("streets-v4");
		expect(state.calls).toEqual([]);
	});

	it("a resolved unlisted id sends no change, and the rows show the resolved id", async () => {
		const { map, state } = await basemapSetup();
		map.basemap.select("outdoor-v2-dark");
		await expect.poll(shownBasemap).toBe("outdoor-v4");
		expect(state.calls).toEqual([]);
	});

	it("picking a Theme sends the variant id as one change", async () => {
		const { state } = await basemapSetup();
		// Settings is end-aligned at the page's left edge here (no MapView to keep it inside).
		(page.getByRole("radio", { name: "Dark" }).element() as HTMLElement).click();
		expect(state.calls).toEqual([{ values: { basemap: "streets-v4-dark" }, changed: ["basemap"] }]);
	});
});

describe("OptionsToolbar, review fixes", () => {
	it("a group added before the open one keeps its menu open and its row focused", async () => {
		const { state } = await setup();
		await trigger("Layers").click();
		const ev = page.getByRole("checkbox", { name: "EV Chargers" }).element() as HTMLElement;
		ev.focus();
		state.groups = [
			{ id: "extra", label: "Extra", rows: [{ kind: "checkbox", id: "x", label: "X" }] },
			...groups()
		];
		await new Promise((r) => setTimeout(r, 0));
		expect(expanded("Layers")).toBe("true");
		expect(document.activeElement).toBe(ev);
	});

	it("Esc with nothing open is left to the map (a pinned card still closes)", async () => {
		await setup();
		const button = trigger("Monitors").element() as HTMLElement;
		button.focus();
		const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		button.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});

	it("a host that doesn't apply a change leaves the checkbox and radio as they were", async () => {
		const { state } = await setup();
		state.ignoreChanges = true;
		await trigger("Monitors").click();
		await page.getByRole("checkbox", { name: "Inactive" }).click();
		expect(state.calls).toHaveLength(1);
		expect(
			(page.getByRole("checkbox", { name: "Inactive" }).element() as HTMLInputElement).checked
		).toBe(false);
		await trigger("PM2.5").click();
		await page.getByRole("radio", { name: /Ozone/ }).click();
		// Ozone closes the menu (closesMenu); the radios are still in the page.
		const radios = [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")];
		expect(radios.find((r) => r.value === "pm25")!.checked).toBe(true);
		expect(radios.find((r) => r.value === "o3")!.checked).toBe(false);
	});

	it("an action that replaces itself keeps its menu open", async () => {
		const state = new ToolbarState({ groups: [], values: {} });
		const swap = (id: string): OptionGroup[] => [
			{
				id: "tools",
				label: "Tools",
				rows: [
					{
						kind: "action",
						id,
						label: `Action ${id}`,
						onclick: () => (state.groups = swap(id === "a" ? "b" : "a"))
					}
				]
			}
		];
		state.groups = swap("a");
		await render(OptionsToolbarHost, { map: newMap(), state });
		await trigger("Tools").click();
		await page.getByRole("button", { name: "Action a" }).click();
		await expect.element(page.getByRole("button", { name: "Action b" })).toBeInTheDocument();
		expect(expanded("Tools")).toBe("true");
	});

	it("row ids can't collide with the toolbar's own ids", async () => {
		const state = new ToolbarState({
			groups: [
				{
					id: "g",
					label: "G",
					rows: [
						{ kind: "select", id: "panel", label: "Panel", choices: [{ value: "a", label: "A" }] }
					]
				}
			],
			values: { panel: "a" }
		});
		await render(OptionsToolbarHost, { map: newMap(), state });
		const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(document.querySelector("select")!.id).toMatch(/-row-panel$/);
	});
});

describe("OptionsToolbar, basemap rows after a fallback", () => {
	it("picking the failed basemap again sends a change, so the host can retry it", async () => {
		const url = (id: string) => `https://tiles.test/maps/${id}/style.json`;
		const map = createMap({
			config: {
				maptilerKey: "k",
				basemaps: {
					styles: [
						{ id: "streets-v4", style: url("streets-v4"), basemap: "Streets", isDefault: true },
						{ id: "outdoor-v4", style: url("outdoor-v4"), basemap: "Outdoor", isDefault: true }
					],
					defaultId: "streets-v4"
				}
			}
		});
		map.attach(createFakeGl({ styleLoaded: true }));
		const settings = settingsGroup(map, { clusters: false, reset: false });
		// The host saved Outdoor; it failed and the map fell back to Streets.
		const state = new ToolbarState({ groups: settings.groups, values: { basemap: "outdoor-v4" } });
		state.basemapKey = "basemap";
		await render(OptionsToolbarHost, { map, state });
		const select = document.querySelector("select")!;
		expect(select.value).toBe("streets-v4");
		select.value = "outdoor-v4";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		expect(state.calls).toEqual([{ values: { basemap: "outdoor-v4" }, changed: ["basemap"] }]);
	});
});

describe("OptionsToolbar, icon-only groups", () => {
	it("an icon-only group without an icon shows its label", async () => {
		await setup();
		const settings = trigger("Settings").element();
		const label = [...settings.querySelectorAll("span")].find((s) => s.textContent === "Settings")!;
		expect(label.getBoundingClientRect().width).toBeGreaterThan(10);
	});

	it("an icon-only group with an icon hides its label visually", async () => {
		const state = new ToolbarState({
			groups: groups().map((g) =>
				g.id === "settings" ? { ...g, icon: { svg: "<svg></svg>" } } : g
			),
			values: values()
		});
		await render(OptionsToolbarHost, { map: newMap(), state });
		const settings = trigger("Settings").element();
		const label = [...settings.querySelectorAll("span")].find((s) => s.textContent === "Settings")!;
		expect(label.getBoundingClientRect().width).toBeLessThanOrEqual(1);
	});
});

describe("OptionsToolbar, final review fixes", () => {
	it("unchecking a select-all's last child hands focus to the group's own checkbox", async () => {
		const { state } = await setup({
			values: { ...values(), "type:purpleair": true, "type:airgradient": false }
		});
		await trigger("Monitors").click();
		const purple = page.getByRole("checkbox", { name: "PurpleAir" }).element() as HTMLInputElement;
		purple.focus();
		await userEvent.keyboard(" ");
		await new Promise((r) => setTimeout(r, 0));
		expect(state.calls.at(-1)?.changed).toEqual(["type:purpleair"]);
		expect(expanded("Monitors")).toBe("true");
		expect(document.activeElement).toBe(
			page.getByRole("checkbox", { name: "Low-cost sensors" }).element()
		);
	});

	it("Esc closes a dropdown a mouse opened, with focus outside the toolbar", async () => {
		await setup();
		(page.getByTestId("outside").element() as HTMLElement).tabIndex = 0;
		(page.getByTestId("outside").element() as HTMLElement).focus();
		trigger("Layers")
			.element()
			.parentElement!.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
		await new Promise((r) => setTimeout(r, 0));
		expect(expanded("Layers")).toBe("true");
		await userEvent.keyboard("{Escape}");
		expect(expanded("Layers")).toBe("false");
	});

	it("a group removed while open is forgotten: it doesn't reopen, and Esc is the map's again", async () => {
		const { state } = await setup();
		await trigger("Layers").click();
		// Off the toolbar: otherwise Settings slides in under the pointer and opens on hover.
		await userEvent.unhover(trigger("Layers"));
		state.groups = groups().filter((g) => g.id !== "layers");
		// Long enough for Chromium's pointer events after a layout change.
		await new Promise((r) => setTimeout(r, 300));
		const button = trigger("Monitors").element() as HTMLElement;
		button.focus();
		const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		button.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		state.groups = groups();
		await new Promise((r) => setTimeout(r, 0));
		expect(expanded("Layers")).toBe("false");
	});

	it("a radio group without a label is named by its group", async () => {
		await setup();
		await trigger("PM2.5").click();
		expect(page.getByRole("radiogroup", { name: "PM2.5" }).query()).not.toBeNull();
	});
});
