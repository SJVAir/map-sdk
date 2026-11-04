import { createRawSnippet } from "svelte";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { FeatureListItem, MapPlugin } from "../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../src/lib/data/format.js";
import { defaultMessages } from "../../src/lib/data/messages.js";
import { NO_LEVEL } from "../../src/lib/data/scale.js";
import type { Level } from "../../src/lib/data/scale-types.js";
import MapTooltip from "../../src/lib/ui/MapTooltip.svelte";

function level(label: string, color: string): Level {
	return { key: label, label, color, opacity: null, tier: 0, description: "", guidance: "" };
}

function item(refKey: string, name: string, lvl: FeatureListItem["level"]): FeatureListItem {
	return {
		refKey,
		ref: { type: "monitor", id: refKey } as never,
		name,
		value: 12.34,
		level: lvl,
		units: "µg/m³",
		lngLat: [-119.7, 36.7],
		selectable: true
	};
}

function fakeMap(
	items: FeatureListItem[],
	state: { focusedKey?: string | null; hovered?: unknown } = {}
): MapContext {
	const plugin: MapPlugin = { id: "points", setup: () => () => {}, features: () => items };
	return {
		plugins: [plugin],
		messages: defaultMessages,
		format: createDefaultFormat(),
		focusedKey: state.focusedKey ?? null,
		hovered: state.hovered ?? null
	} as never;
}

const project = () => ({ x: 100, y: 100 });

describe("MapTooltip", () => {
	it("shows the focused plugin's item when two plugins list the same refKey", async () => {
		const plugin = (id: string, name: string): MapPlugin => ({
			id,
			setup: () => () => {},
			features: () => [item("a", name, level("Good", "#00e400"))]
		});
		const map = {
			plugins: [plugin("first", "First site"), plugin("second", "Second site")],
			messages: defaultMessages,
			format: createDefaultFormat(),
			focusedKey: "a",
			focusedPluginId: "second",
			hovered: null
		} as never;
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		expect(document.querySelector(".mapsdk-tooltip-name")!.textContent).toBe("Second site");
	});

	it("shows the focused item's name, value, and level label", async () => {
		const map = fakeMap([item("a", "Fresno Yosemite", level("Moderate", "#ff7e00"))], {
			focusedKey: "a"
		});
		render(MapTooltip, { map, project });
		const tip = page.getByRole("tooltip");
		await expect.element(tip).toHaveTextContent("Fresno Yosemite 12.34 µg/m³ Moderate");
	});

	it("uses black text on a yellow chip", async () => {
		const map = fakeMap([item("a", "Yellow", level("Moderate", "#ffff00"))], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		await expect.element(page.getByText("Moderate")).toBeVisible();
		const chip = page.getByText("Moderate").element() as HTMLElement;
		expect(getComputedStyle(chip).color).toBe("rgb(0, 0, 0)");
	});

	it("shows No level for an empty-color level without throwing", async () => {
		const map = fakeMap([item("a", "Gray", level("Broken", ""))], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Gray 12.34 µg/m³ No level");
	});

	it("shows No level for NO_LEVEL", async () => {
		const map = fakeMap([item("a", "Gray", NO_LEVEL)], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Gray 12.34 µg/m³ No level");
	});

	it("shows the hit name alone when the item is not in the data", async () => {
		const hit = {
			pluginId: "points",
			ref: { type: "monitor", id: "z" },
			refKey: "z",
			name: "Ghost"
		};
		const map = fakeMap([], { hovered: { hit, lngLat: [-119.7, 36.7] } });
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Ghost");
	});

	it("renders nothing with no hover or focus", async () => {
		const map = fakeMap([item("a", "A", NO_LEVEL)]);
		render(MapTooltip, { map, project });
		expect(page.getByRole("tooltip").elements()).toHaveLength(0);
	});

	it("prefers the focused item over the hovered hit", async () => {
		const hit = { pluginId: "points", ref: { type: "monitor", id: "b" }, refKey: "b", name: "B" };
		const map = fakeMap([item("a", "Focused", NO_LEVEL), item("b", "Hovered", NO_LEVEL)], {
			focusedKey: "a",
			hovered: { hit, lngLat: [0, 0] }
		});
		render(MapTooltip, { map, project });
		await expect
			.element(page.getByRole("tooltip"))
			.toHaveTextContent("Focused 12.34 µg/m³ No level");
	});

	it("shows value and chip for a hovered hit whose item is found", async () => {
		const hit = { pluginId: "points", ref: { type: "monitor", id: "a" }, refKey: "a", name: "A" };
		const map = fakeMap([item("a", "Found", level("Good", "#00e400"))], {
			hovered: { hit, lngLat: [0, 0] }
		});
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Found 12.34 µg/m³ Good");
	});

	it("lets a plugin's tooltip snippet replace the value and chip", async () => {
		const map = fakeMap([item("a", "Custom", level("Good", "#00e400"))], { focusedKey: "a" });
		(map.plugins[0] as { tooltip?: unknown }).tooltip = () =>
			createRawSnippet(() => ({ render: () => "<p>Extra</p>" }));
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Custom Extra");
	});

	it("uses a neutral chip for an unparseable color", async () => {
		const map = fakeMap([item("a", "Odd", level("Weird", "not-a-color"))], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		const chip = page.getByText("Weird").element() as HTMLElement;
		expect(chip.classList.contains("neutral")).toBe(true);
	});

	it("handles null and string values", async () => {
		const nullItem = { ...item("a", "Null", NO_LEVEL), value: null };
		render(MapTooltip, { map: fakeMap([nullItem], { focusedKey: "a" }), project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Null No level");
	});

	it("shows a string value as given", async () => {
		const str = { ...item("a", "Str", NO_LEVEL), value: "high" };
		render(MapTooltip, { map: fakeMap([str], { focusedKey: "a" }), project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Str high µg/m³ No level");
	});

	it("stays inside the container", async () => {
		const map = fakeMap([item("a", "Edge", NO_LEVEL)], { focusedKey: "a" });
		render(MapTooltip, { map, project: () => ({ x: 2, y: 2 }), width: 300, height: 200 });
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		const r = (page.getByRole("tooltip").element() as HTMLElement).getBoundingClientRect();
		const host = (page.getByRole("tooltip").element() as HTMLElement).offsetParent;
		const h = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
		expect(r.left).toBeGreaterThanOrEqual(h.left - 0.5);
		expect(r.top).toBeGreaterThanOrEqual(h.top - 0.5);
	});
});
