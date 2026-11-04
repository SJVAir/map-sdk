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
});
