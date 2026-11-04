import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import axe from "axe-core";
import { createMap, type MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { FeatureListItem, MapPlugin } from "../../src/lib/core/plugin.js";
import type { SelectionMode } from "../../src/lib/data/types.js";
import { NO_LEVEL } from "../../src/lib/data/scale.js";
import type { Level } from "../../src/lib/data/scale-types.js";
import FeatureList from "../../src/lib/ui/FeatureList.svelte";

const good: Level = {
	key: "good",
	label: "Good",
	color: "#00e400",
	opacity: null,
	tier: 0,
	description: "",
	guidance: ""
};

function item(id: string, name: string, extra: Partial<FeatureListItem> = {}): FeatureListItem {
	return {
		refKey: `monitor:${id}`,
		ref: { kind: "monitor", id },
		name,
		value: 5,
		level: good,
		units: "µg/m³",
		lngLat: [-119.5, 36.5],
		selectable: true,
		...extra
	};
}

function listed(id: string, items: FeatureListItem[]): MapPlugin {
	return { id, setup: () => () => {}, features: () => items };
}

const SITES = [item("1", "Arvin"), item("2", "Bakersfield"), item("3", "Clovis")];

function newMap(
	mode: SelectionMode,
	items: FeatureListItem[] = SITES,
	onselectionchange = vi.fn()
): { map: MapContext; onselectionchange: ReturnType<typeof vi.fn> } {
	const map = createMap({ config: { maptilerKey: "test-key" } });
	map.addPlugin(listed("monitors", items), { selectionMode: mode, onselectionchange });
	return { map, onselectionchange };
}

const listbox = () => page.getByRole("listbox", { name: "Features on the map" });
const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
const option = (name: string) => options().find((o) => o.textContent!.includes(name))!;

async function focusList() {
	await expect.element(listbox()).toBeVisible();
	(listbox().element() as HTMLElement).focus();
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("FeatureList", () => {
	it("is one labelled listbox with a row per feature, named by its label", async () => {
		const { map } = newMap("single");
		render(FeatureList, { map });
		await expect.element(listbox()).toHaveAttribute("tabindex", "0");
		await expect
			.element(page.getByRole("option", { name: "Arvin, 5 µg/m³, Good" }))
			.toBeInTheDocument();
		expect(options()).toHaveLength(3);
		expect(options()[0].dataset.mapsdkRef).toBe("monitor:1");
		expect(options()[0].dataset.mapsdkPlugin).toBe("monitors");
		expect(listbox().element().getAttribute("aria-multiselectable")).toBeNull();
		expect(listbox().element().closest("[data-mapsdk-map]")?.getAttribute("data-mapsdk-map")).toBe(
			map.uid
		);
	});

	it("holds under 100 rows in the DOM with 5,000 features, and follows the scroll", async () => {
		const many = Array.from({ length: 5000 }, (_, i) =>
			item(String(i), `Site ${String(i).padStart(4, "0")}`)
		);
		const { map } = newMap("single", many);
		render(FeatureList, { map });
		await expect.element(listbox()).toBeVisible();
		expect(options().length).toBeGreaterThan(10);
		expect(options().length).toBeLessThan(100);
		expect(options()[0].getAttribute("aria-setsize")).toBe("5000");

		const box = listbox().element().parentElement as HTMLElement;
		box.scrollTop = box.scrollHeight / 2;
		box.dispatchEvent(new Event("scroll"));
		await vi.waitFor(() => expect(options()[0].getAttribute("aria-posinset")).not.toBe("1"));
		expect(options().length).toBeLessThan(100);
		const first = Number(options()[0].getAttribute("aria-posinset"));
		expect(first).toBeGreaterThan(2000);
	});

	it("moves with Down, Up, Home, and End, focusing each row's feature", async () => {
		const { map } = newMap("single");
		const focus = vi.spyOn(map, "focusFeature");
		render(FeatureList, { map });
		await focusList();
		const box = listbox().element();
		await vi.waitFor(() =>
			expect(box.getAttribute("aria-activedescendant")).toBe(option("Arvin").id)
		);
		await userEvent.keyboard("{ArrowDown}");
		expect(box.getAttribute("aria-activedescendant")).toBe(option("Bakersfield").id);
		expect(focus).toHaveBeenLastCalledWith("monitor:2", "monitors");
		await userEvent.keyboard("{End}");
		expect(box.getAttribute("aria-activedescendant")).toBe(option("Clovis").id);
		await userEvent.keyboard("{ArrowDown}");
		expect(box.getAttribute("aria-activedescendant")).toBe(option("Clovis").id);
		await userEvent.keyboard("{Home}");
		expect(box.getAttribute("aria-activedescendant")).toBe(option("Arvin").id);
		await userEvent.keyboard("{ArrowUp}");
		expect(box.getAttribute("aria-activedescendant")).toBe(option("Arvin").id);
		expect(map.focusedKey).toBe("monitor:1");

		(box as HTMLElement).blur();
		expect(map.focusedKey).toBeNull();
	});

	it("jumps to a typed name, and starts over after a pause", async () => {
		const sites = [item("1", "Arvin"), item("2", "Bakersfield"), item("3", "Bass Lake")];
		const { map } = newMap("single", sites);
		render(FeatureList, { map });
		await focusList();
		const box = listbox().element();
		await userEvent.keyboard("ba");
		expect(box.getAttribute("aria-activedescendant")).toBe(option("Bakersfield").id);
		await userEvent.keyboard("s");
		expect(box.getAttribute("aria-activedescendant")).toBe(option("Bass Lake").id);
		await new Promise((r) => setTimeout(r, 600));
		await userEvent.keyboard("a");
		expect(box.getAttribute("aria-activedescendant")).toBe(option("Arvin").id);
	});

	it("adds the row's id with Space on a multiple plugin", async () => {
		const { map, onselectionchange } = newMap("multiple");
		map.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		render(FeatureList, { map });
		await expect.element(listbox()).toHaveAttribute("aria-multiselectable", "true");
		await focusList();
		// Focus starts on the selected row.
		await vi.waitFor(() =>
			expect(listbox().element().getAttribute("aria-activedescendant")).toBe(option("Arvin").id)
		);
		await userEvent.keyboard("{ArrowDown}");
		await userEvent.keyboard(" ");
		expect(onselectionchange).toHaveBeenLastCalledWith({ kind: "monitors", ids: ["1", "2"] });
		await expect
			.element(page.getByRole("option", { name: /Bakersfield/ }))
			.toHaveAttribute("aria-selected", "true");
		expect(option("Arvin").getAttribute("aria-selected")).toBe("true");
		expect(option("Bakersfield").querySelector(".mapsdk-list-check svg")).not.toBeNull();
	});

	it("replaces the selection with Enter on a single plugin", async () => {
		const { map, onselectionchange } = newMap("single");
		map.setSelection("monitors", { kind: "monitors", ids: ["1"] });
		render(FeatureList, { map });
		await focusList();
		await userEvent.keyboard("{End}");
		await userEvent.keyboard("{Enter}");
		expect(onselectionchange).toHaveBeenLastCalledWith({ kind: "monitors", ids: ["3"] });
		await expect
			.element(page.getByRole("option", { name: /Clovis/ }))
			.toHaveAttribute("aria-selected", "true");
		expect(option("Arvin").getAttribute("aria-selected")).toBe("false");
	});

	it("focuses and pans to a non-selectable row but doesn't select it", async () => {
		const sites = [item("1", "Arvin", { selectable: false }), item("2", "Bakersfield")];
		const { map, onselectionchange } = newMap("single", sites);
		const focus = vi.spyOn(map, "focusFeature");
		render(FeatureList, { map });
		await focusList();
		await vi.waitFor(() => expect(focus).toHaveBeenCalledWith("monitor:1", "monitors"));
		await userEvent.keyboard("{Enter}");
		expect(onselectionchange).not.toHaveBeenCalled();
		expect(option("Arvin").hasAttribute("aria-selected")).toBe(false);
	});

	it("picks a clicked row, adding with shift", async () => {
		const { map, onselectionchange } = newMap("multiple");
		render(FeatureList, { map });
		await expect.element(listbox()).toBeVisible();
		await page.getByRole("option", { name: /Bakersfield/ }).click();
		expect(onselectionchange).toHaveBeenLastCalledWith({ kind: "monitors", ids: ["2"] });
		await page.getByRole("option", { name: /Clovis/ }).click({ modifiers: ["Shift"] });
		expect(onselectionchange).toHaveBeenLastCalledWith({ kind: "monitors", ids: ["2", "3"] });
	});

	it("sends Shift+F10 on the active row as a contextmenu event the map resolves", async () => {
		const { map } = newMap("single");
		render(FeatureList, { map });
		const seen: Array<ReturnType<MapContext["featureForElement"]>> = [];
		const listener = (e: Event) => {
			seen.push(map.featureForElement(e.target as Element));
			e.preventDefault();
		};
		document.addEventListener("contextmenu", listener);
		try {
			await focusList();
			await userEvent.keyboard("{ArrowDown}");
			await userEvent.keyboard("{Shift>}{F10}{/Shift}");
			await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
			// Give a browser-sent keyboard menu event time to arrive; it must not add a second one.
			await new Promise((r) => setTimeout(r, 50));
			// One the browser sends to the focused listbox (e.g. on keyup) goes to the active row.
			await new Promise((r) => setTimeout(r, 1000));
			listbox()
				.element()
				.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
			await vi.waitFor(() => expect(seen).toHaveLength(2));
		} finally {
			document.removeEventListener("contextmenu", listener);
		}
		const bakersfield = {
			pluginId: "monitors",
			ref: { kind: "monitor", id: "2" },
			refKey: "monitor:2",
			name: "Bakersfield"
		};
		expect(seen).toEqual([bakersfield, bakersfield]);
	});

	it("lists only features in view, re-computed when the view changes", async () => {
		const sites = [
			item("1", "Arvin", { lngLat: [-118.8, 35.2] }),
			item("2", "Fresno", { lngLat: [-119.8, 36.7] })
		];
		const { map } = newMap("single", sites);
		render(FeatureList, { map });
		await expect.element(listbox()).toBeVisible();
		expect(options()).toHaveLength(2);
		const camera = { center: [-119.8, 36.7] as [number, number], zoom: 10, bearing: 0, pitch: 0 };
		map.updateView(camera, { west: -120, south: 36.5, east: -119.5, north: 37 });
		await vi.waitFor(() => expect(options()).toHaveLength(1));
		expect(options()[0].textContent).toContain("Fresno");

		map.updateView(camera, { west: -121, south: 30, east: -118, north: 31 });
		await expect.element(page.getByText("Nothing on the map in this view")).toBeVisible();
	});

	it("sorts by value, highest first, with no reading last", async () => {
		const sites = [
			item("1", "Arvin", { value: 3 }),
			item("2", "Bakersfield", { value: null, level: NO_LEVEL }),
			item("3", "Clovis", { value: 40 })
		];
		const { map } = newMap("single", sites);
		render(FeatureList, { map });
		await page.getByRole("button", { name: "Value" }).click();
		await expect
			.element(page.getByRole("button", { name: "Value" }))
			.toHaveAttribute("aria-pressed", "true");
		expect(options().map((o) => o.querySelector(".mapsdk-list-name")!.textContent)).toEqual([
			"Clovis",
			"Arvin",
			"Bakersfield"
		]);
		expect(option("Bakersfield").getAttribute("aria-label")).toBe("Bakersfield, no reading");
	});

	it("has no axe violations, with rows and selection or empty", async () => {
		const { map } = newMap("multiple");
		map.setSelection("monitors", { kind: "monitors", ids: ["2"] });
		render(FeatureList, { map });
		await focusList();
		await vi.waitFor(() =>
			expect(listbox().element().getAttribute("aria-activedescendant")).not.toBeNull()
		);
		let result = await axe.run(document.querySelector(".mapsdk-list")!);
		expect(result.violations).toEqual([]);

		map.updateView(map.camera, { west: 0, south: 0, east: 1, north: 1 });
		await expect.element(page.getByText("Nothing on the map in this view")).toBeVisible();
		result = await axe.run(document.querySelector(".mapsdk-list")!);
		expect(result.violations).toEqual([]);
	});
});
