import { createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
import type { FeatureListItem, MapPlugin } from "../../src/lib/core/plugin.js";
import { createDefaultFormat } from "../../src/lib/data/format.js";
import { defaultMessages } from "../../src/lib/data/messages.js";
import { NO_LEVEL } from "../../src/lib/data/scale.js";
import type { Level } from "../../src/lib/data/scale-types.js";
import MapTooltip from "../../src/lib/ui/MapTooltip.svelte";
import type { CardContext } from "../../src/lib/ui/card.js";

function level(label: string, color: string): Level {
	return {
		key: label,
		label,
		color,
		opacity: null,
		tier: 0,
		description: "",
		guidance: "",
		min: null,
		max: null,
		value: null
	};
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

	it("leaves the name header out when the plugin's tooltip content shows the name", async () => {
		const content = createRawSnippet(() => ({ render: () => "<span>Own layout</span>" }));
		const make = (tooltipShowsName: boolean): MapContext =>
			({
				plugins: [
					{
						id: "points",
						setup: () => () => {},
						features: () => [item("a", "Fresno Yosemite", NO_LEVEL)],
						tooltip: () => content,
						tooltipShowsName
					}
				],
				messages: defaultMessages,
				format: createDefaultFormat(),
				focusedKey: "a",
				hovered: null
			}) as never;
		render(MapTooltip, { map: make(true), project });
		await expect.element(page.getByText("Own layout")).toBeVisible();
		expect(document.querySelector(".mapsdk-tooltip-name")).toBeNull();
	});

	it("keeps the name header above plugin content that doesn't show the name", async () => {
		const content = createRawSnippet(() => ({ render: () => "<span>Own layout</span>" }));
		const map = {
			plugins: [
				{
					id: "points",
					setup: () => () => {},
					features: () => [item("a", "Fresno Yosemite", NO_LEVEL)],
					tooltip: () => content
				}
			],
			messages: defaultMessages,
			format: createDefaultFormat(),
			focusedKey: "a",
			hovered: null
		} as never;
		render(MapTooltip, { map, project });
		await expect.element(page.getByText("Own layout")).toBeVisible();
		expect(document.querySelector(".mapsdk-tooltip-name")!.textContent).toBe("Fresno Yosemite");
	});

	it("shows the focused item's name, value, and level label", async () => {
		const map = fakeMap([item("a", "Fresno Yosemite", level("Moderate", "#ff7e00"))], {
			focusedKey: "a"
		});
		render(MapTooltip, { map, project });
		const tip = page.getByRole("tooltip");
		await expect.element(tip).toHaveTextContent("Fresno Yosemite 12.34 µg/m³ Moderate");
	});

	it("rounds the value to the item's precision", async () => {
		const rounded = { ...item("a", "Fresno", level("Moderate", "#ff7e00")), precision: 1 };
		render(MapTooltip, { map: fakeMap([rounded], { focusedKey: "a" }), project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Fresno 12.3 µg/m³ Moderate");
	});

	it("uses black text on a yellow chip", async () => {
		const map = fakeMap([item("a", "Yellow", level("Moderate", "#ffff00"))], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		await expect.element(page.getByText("Moderate")).toBeVisible();
		const chip = page.getByText("Moderate").element() as HTMLElement;
		expect(getComputedStyle(chip).color).toBe("rgb(0, 0, 0)");
	});

	it("shows an empty-color level's label on a neutral chip without throwing", async () => {
		const map = fakeMap([item("a", "Gray", level("Unknown", ""))], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Gray 12.34 µg/m³ Unknown");
		expect(page.getByText("Unknown").element().classList.contains("neutral")).toBe(true);
	});

	it("shows No level for NO_LEVEL", async () => {
		const map = fakeMap([item("a", "Gray", NO_LEVEL)], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Gray 12.34 µg/m³ No level");
	});

	it("shows a place with no reading by its name alone", async () => {
		const place = { ...item("a", "Your location", NO_LEVEL), value: null, noReading: true };
		const map = fakeMap([place], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Your location");
		expect(document.querySelector(".mapsdk-tooltip-chip")).toBeNull();
	});

	it("shows a detail as plain text in place of the chip", async () => {
		const ev = { ...item("a", "Fresno Station", NO_LEVEL), value: null, detail: "Level 2 charger" };
		const map = fakeMap([ev], { focusedKey: "a" });
		render(MapTooltip, { map, project });
		const tooltip = page.getByRole("tooltip");
		await expect.element(tooltip).toHaveTextContent("Fresno Station Level 2 charger");
		expect(tooltip.element().querySelector(".mapsdk-tooltip-chip")).toBeNull();
		expect(tooltip.element().querySelector(".mapsdk-tooltip-detail")!.textContent!.trim()).toBe(
			"Level 2 charger"
		);
	});

	it("shows the level's chip, not the detail, when there is a level", async () => {
		const map = fakeMap(
			[{ ...item("a", "Fresno", level("Good", "#00e400")), detail: "Level 2 charger" }],
			{
				focusedKey: "a"
			}
		);
		render(MapTooltip, { map, project });
		const tooltip = page.getByRole("tooltip");
		await expect.element(tooltip).toHaveTextContent("Fresno 12.34 µg/m³ Good");
		expect(tooltip.element().querySelector(".mapsdk-tooltip-chip")).not.toBeNull();
		expect(tooltip.element().querySelector(".mapsdk-tooltip-detail")).toBeNull();
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

	it("keeps the narrow width for other content and widens only the wide cards", async () => {
		const wide = (cls: string) => {
			const map = fakeMap([item("a", "Wide", NO_LEVEL)], { focusedKey: "a" });
			(map.plugins[0] as { tooltip?: unknown }).tooltip = () =>
				createRawSnippet(() => ({
					render: () => `<div class="${cls}" style="width:600px;flex:none">x</div>`
				}));
			render(MapTooltip, { map, project });
		};
		wide("other");
		wide("mapsdk-tooltip-wide");
		await expect.poll(() => document.querySelectorAll(".mapsdk-tooltip").length).toBe(2);
		const [plain, card] = [...document.querySelectorAll<HTMLElement>(".mapsdk-tooltip")].map(
			(e) => e.offsetWidth
		);
		expect(plain).toBeLessThanOrEqual(256);
		expect(card).toBeGreaterThan(256);
		expect(card).toBeLessThanOrEqual(448);
	});

	it("shows a plugin's hover content for a hit it doesn't list, without an empty name", async () => {
		const hit = {
			pluginId: "points",
			ref: { kind: "feature", id: "cluster:7" },
			refKey: "feature:cluster:7",
			name: ""
		};
		const map = fakeMap([], { hovered: { hit, lngLat: [0, 0] } });
		const hoverTooltip = vi.fn(() => createRawSnippet(() => ({ render: () => "<p>Cluster</p>" })));
		(map.plugins[0] as { hoverTooltip?: unknown }).hoverTooltip = hoverTooltip;
		render(MapTooltip, { map, project });
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Cluster");
		expect(hoverTooltip).toHaveBeenCalledWith(hit);
		expect(document.querySelector(".mapsdk-tooltip-name")).toBeNull();
	});

	it("renders nothing for a nameless hit with no item or content", async () => {
		const hit = {
			pluginId: "points",
			ref: { kind: "feature", id: "cluster:7" },
			refKey: "feature:cluster:7",
			name: ""
		};
		render(MapTooltip, { map: fakeMap([], { hovered: { hit, lngLat: [0, 0] } }), project });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(page.getByRole("tooltip").elements()).toHaveLength(0);
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

	describe("tooltip mode", () => {
		function fakeGl() {
			const listeners = new Map<string, Set<() => void>>();
			return {
				on(type: string, fn: () => void) {
					if (!listeners.has(type)) listeners.set(type, new Set());
					listeners.get(type)!.add(fn);
				},
				off(type: string, fn: () => void) {
					listeners.get(type)?.delete(fn);
				},
				emit(type: string) {
					for (const fn of listeners.get(type) ?? []) fn();
				}
			};
		}
		const hit = { pluginId: "points", refKey: "a", name: "Hovered site" } as never;
		const hoverMap = (lngLat: [number, number]) => fakeMap([], { hovered: { hit, lngLat } });

		it("pointer mode hides the tooltip on zoom", async () => {
			const gl = fakeGl();
			render(MapTooltip, { map: hoverMap([0, 0]), project, mode: "pointer", gl: gl as never });
			await expect.element(page.getByRole("tooltip")).toBeVisible();
			gl.emit("zoomstart");
			await vi.waitFor(() => expect(document.querySelector("[role=tooltip]")).toBeNull());
		});

		it("pointer mode shows it again on the next move", async () => {
			const gl = fakeGl();
			const screen = await render(MapTooltip, {
				map: hoverMap([0, 0]),
				project,
				mode: "pointer",
				gl: gl as never
			});
			await expect.element(page.getByRole("tooltip")).toBeVisible();
			gl.emit("zoomstart");
			await vi.waitFor(() => expect(document.querySelector("[role=tooltip]")).toBeNull());
			await screen.rerender({ map: hoverMap([1, 1]) });
			await expect.element(page.getByRole("tooltip")).toBeVisible();
		});

		it("pointer mode anchors at the pointer, not the feature", async () => {
			const seen: Array<[number, number]> = [];
			const record = (p: [number, number]) => (seen.push(p), { x: 100, y: 100 });
			render(MapTooltip, { map: hoverMap([5, 6]), project: record, mode: "pointer" });
			await expect.element(page.getByRole("tooltip")).toBeVisible();
			expect(seen.at(-1)).toEqual([5, 6]);
		});

		it("pointer mode still pins a keyboard-focused item", async () => {
			const gl = fakeGl();
			const map = fakeMap([item("a", "Fresno", level("Good", "#00e400"))], { focusedKey: "a" });
			render(MapTooltip, { map, project, mode: "pointer", gl: gl as never });
			gl.emit("zoomstart");
			await expect.element(page.getByRole("tooltip")).toBeVisible();
		});

		it("pinned mode keeps it through a zoom", async () => {
			const gl = fakeGl();
			render(MapTooltip, { map: hoverMap([0, 0]), project, mode: "pinned", gl: gl as never });
			await expect.element(page.getByRole("tooltip")).toBeVisible();
			gl.emit("zoomstart");
			await new Promise((r) => setTimeout(r, 50));
			expect(document.querySelector("[role=tooltip]")).not.toBeNull();
		});
	});
});

describe("MapTooltip card", () => {
	const good = level("Good", "#00e400");

	function hit(refKey: string, name: string) {
		return {
			hit: { pluginId: "points", ref: { kind: "monitor", id: refKey }, refKey, name },
			lngLat: [-119.7, 36.7] as [number, number]
		};
	}

	function cardMap(
		items: FeatureListItem[],
		state: { pinned?: unknown; hovered?: unknown; focusedKey?: string | null } = {},
		unpin = vi.fn()
	): MapContext {
		const plugin: MapPlugin = { id: "points", setup: () => () => {}, features: () => items };
		return {
			plugins: [plugin],
			messages: defaultMessages,
			format: createDefaultFormat(),
			focusedKey: state.focusedKey ?? null,
			focusedPluginId: null,
			hovered: state.hovered ?? null,
			pinned: state.pinned ?? null,
			bounds: null,
			unpin
		} as never;
	}

	const sites = () => [item("a", "Site A", good), item("b", "Site B", good)];

	it("pins a place with no reading as a card with its name alone", async () => {
		const place = { ...item("a", "Your location", NO_LEVEL), value: null, noReading: true };
		await render(MapTooltip, {
			map: cardMap([place], { pinned: hit("a", "Your location") }),
			project,
			card: true
		});
		const card = page.getByRole("group", { name: "Your location" });
		await expect.element(card).toBeVisible();
		expect(card.element().textContent).not.toContain("No level");
		expect(document.querySelector(".mapsdk-tooltip-chip")).toBeNull();
	});

	it("shows a pinned feature with a Close button, and takes the pointer", async () => {
		await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A") }),
			project,
			card: true
		});
		const card = page.getByRole("group", { name: "Site A" });
		await expect.element(card).toBeVisible();
		await expect.element(card.getByRole("button", { name: "Close" })).toBeVisible();
		expect(getComputedStyle(card.element()).pointerEvents).toBe("auto");
	});

	it("hides the hover while something is pinned", async () => {
		await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A"), hovered: hit("b", "Site B") }),
			project,
			card: true
		});
		await expect.element(page.getByRole("group", { name: "Site A" })).toBeVisible();
		expect(document.body.textContent).not.toContain("Site B");
	});

	it("prefers the focused item over the pinned one", async () => {
		await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A"), focusedKey: "b" }),
			project,
			card: true
		});
		await expect.element(page.getByRole("group", { name: "Site B" })).toBeVisible();
	});

	it("close button unpins and returns focus to where it came from", async () => {
		const before = document.createElement("button");
		before.textContent = "Before";
		document.body.prepend(before);
		const unpin = vi.fn();
		await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A") }, unpin),
			project,
			card: true
		});
		before.focus();
		await userEvent.keyboard("{Tab}");
		const close = page.getByRole("button", { name: "Close" });
		await expect.element(close).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		expect(unpin).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(before);
		before.remove();
	});

	it("returns focus to the map region when the origin is gone", async () => {
		const before = document.createElement("button");
		document.body.prepend(before);
		const { container } = await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A") }),
			project,
			card: true
		});
		container.setAttribute("data-mapsdk-map", "m1");
		before.focus();
		await userEvent.keyboard("{Tab}");
		before.remove();
		await userEvent.keyboard("{Enter}");
		expect(document.activeElement).toBe(container);
	});

	it("Escape inside the card closes it and doesn't bubble", async () => {
		const unpin = vi.fn();
		const outer = vi.fn();
		document.addEventListener("keydown", outer);
		await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A") }, unpin),
			project,
			card: true
		});
		(page.getByRole("button", { name: "Close" }).element() as HTMLElement).focus();
		await userEvent.keyboard("{Escape}");
		expect(unpin).toHaveBeenCalledTimes(1);
		expect(outer).not.toHaveBeenCalled();
		document.removeEventListener("keydown", outer);
	});

	it("hides while its anchor is off-screen", async () => {
		const map = cardMap(sites(), { pinned: hit("a", "Site A") });
		const { rerender } = await render(MapTooltip, {
			map,
			project: () => ({ x: -50, y: 100 }),
			width: 400,
			height: 300,
			card: true
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(document.querySelector(".mapsdk-tooltip")).toBeNull();
		await rerender({ project: () => ({ x: 100, y: 100 }) });
		await expect.element(page.getByRole("group", { name: "Site A" })).toBeVisible();
	});

	it("unpins when the pinned item leaves the plugin's features", async () => {
		const unpin = vi.fn();
		const pinned = hit("a", "Site A");
		const { rerender } = await render(MapTooltip, {
			map: cardMap(sites(), { pinned }, unpin),
			project,
			card: true
		});
		await expect.element(page.getByRole("group", { name: "Site A" })).toBeVisible();
		expect(unpin).not.toHaveBeenCalled();
		await rerender({ map: cardMap([item("b", "Site B", good)], { pinned }, unpin) });
		await vi.waitFor(() => expect(unpin).toHaveBeenCalledTimes(1));
	});

	it("keeps a pinned hit its plugin never listed (an HMS fire hotspot)", async () => {
		const unpin = vi.fn();
		const content = createRawSnippet(() => ({ render: () => "<span>Hotspot box</span>" }));
		const map = {
			...cardMap(sites(), { pinned: hit("hot", "Hotspot") }, unpin),
			plugins: [
				{
					id: "points",
					setup: () => () => {},
					features: () => sites(),
					hoverTooltip: () => content
				}
			]
		} as never;
		await render(MapTooltip, { map, project, card: true });
		await expect.element(page.getByText("Hotspot box")).toBeVisible();
		await new Promise((r) => setTimeout(r, 50));
		expect(unpin).not.toHaveBeenCalled();
	});

	it("hands focus back when the card goes away without Close (host unpin, plugin removed)", async () => {
		const before = document.createElement("button");
		document.body.prepend(before);
		const pinned = hit("a", "Site A");
		const { rerender } = await render(MapTooltip, {
			map: cardMap(sites(), { pinned }),
			project,
			card: true
		});
		before.focus();
		await userEvent.keyboard("{Tab}");
		await expect.element(page.getByRole("button", { name: "Close" })).toHaveFocus();
		await rerender({ map: cardMap(sites(), { pinned: null }) });
		await expect.element(page.getByRole("group", { name: "Site A" })).not.toBeInTheDocument();
		expect(document.activeElement).toBe(before);
		before.remove();
	});

	it("hands focus to the map region when the card hides off-screen with focus inside", async () => {
		const before = document.createElement("button");
		document.body.prepend(before);
		const { container, rerender } = await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A") }),
			project,
			width: 400,
			height: 300,
			card: true
		});
		container.setAttribute("data-mapsdk-map", "m1");
		before.focus();
		await userEvent.keyboard("{Tab}");
		before.remove();
		await rerender({ project: () => ({ x: -50, y: 100 }) });
		await vi.waitFor(() => expect(document.querySelector(".mapsdk-card")).toBeNull());
		expect(document.activeElement).toBe(container);
	});

	it("unpins a pinned hit with nothing to show", async () => {
		const unpin = vi.fn();
		await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("nothing", "") }, unpin),
			project,
			card: true
		});
		await vi.waitFor(() => expect(unpin).toHaveBeenCalledTimes(1));
	});

	it("doesn't return focus to an origin from an earlier card", async () => {
		const before = document.createElement("button");
		before.textContent = "Before";
		const after = document.createElement("button");
		after.textContent = "After";
		document.body.prepend(before);
		const { container, rerender } = await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A") }),
			project,
			card: true
		});
		container.setAttribute("data-mapsdk-map", "m1");
		document.body.append(after);
		before.focus();
		await userEvent.keyboard("{Tab}");
		await expect.element(page.getByRole("button", { name: "Close" })).toHaveFocus();
		after.focus();
		await rerender({ map: cardMap(sites(), { pinned: hit("b", "Site B") }) });
		after.blur();
		(page.getByRole("button", { name: "Close" }).element() as HTMLElement).focus();
		await userEvent.keyboard("{Enter}");
		expect(document.activeElement).not.toBe(before);
		expect(document.activeElement).toBe(container);
		before.remove();
		after.remove();
	});

	const selectButton = createRawSnippet((ctx: () => CardContext) => ({
		render: () => `<button type="button">${ctx().selected ? "Remove" : "Select"}</button>`,
		setup: (node: Element) => {
			node.addEventListener("click", () => ctx().toggle());
		}
	}));

	function withSelection(map: MapContext, ids: string[], togglePick = vi.fn()): MapContext {
		return {
			...(map as object),
			getSelection: () => (ids.length ? { kind: "monitors", ids } : null),
			getSelectionMode: () => "multiple",
			togglePick
		} as never;
	}

	/** A monitor item shaped like the monitors preset's: `monitor:<id>` refKeys. */
	function monitorItem(id: string, name: string): FeatureListItem {
		return { ...item(`monitor:${id}`, name, good), ref: { kind: "monitor", id } };
	}
	function monitorHit(id: string, name: string) {
		return {
			hit: {
				pluginId: "points",
				ref: { kind: "monitor", id },
				refKey: `monitor:${id}`,
				name
			},
			lngLat: [-119.7, 36.7] as [number, number]
		};
	}

	it("renders the host's actions with the card's feature and selection", async () => {
		const map = withSelection(
			cardMap([monitorItem("a", "Site A")], { pinned: monitorHit("a", "Site A") }),
			["a"]
		);
		await render(MapTooltip, { map, project, card: true, actions: selectButton });
		const card = page.getByRole("group", { name: "Site A" });
		await expect.element(card.getByRole("button", { name: "Remove" })).toBeVisible();
	});

	it("an action's toggle calls map.togglePick with the card's plugin and ref", async () => {
		const togglePick = vi.fn();
		const map = withSelection(
			cardMap([monitorItem("a", "Site A")], { pinned: monitorHit("a", "Site A") }),
			[],
			togglePick
		);
		await render(MapTooltip, { map, project, card: true, actions: selectButton });
		await page.getByRole("button", { name: "Select" }).click();
		expect(togglePick).toHaveBeenCalledWith("points", { kind: "monitor", id: "a" });
	});

	it("tells the actions whether the card's feature can be selected", async () => {
		const shown: string[] = [];
		const probe = createRawSnippet((ctx: () => CardContext) => ({
			render: () => `<span>${ctx().selectable ? "can select" : "can't select"}</span>`,
			setup: () => {
				shown.push(String(ctx().selectable));
			}
		}));
		const make = (mode: string, pinned: unknown, items: FeatureListItem[]) =>
			({
				...(withSelection(cardMap(items, { pinned }), []) as object),
				getSelectionMode: () => mode
			}) as never;
		const monitor = [monitorItem("a", "Site A")];
		const a = await render(MapTooltip, {
			map: make("multiple", monitorHit("a", "Site A"), monitor),
			project,
			card: true,
			actions: probe
		});
		await expect.element(page.getByText("can select", { exact: true })).toBeVisible();
		await a.unmount();
		const b = await render(MapTooltip, {
			map: make("none", monitorHit("a", "Site A"), monitor),
			project,
			card: true,
			actions: probe
		});
		await expect.element(page.getByText("can't select")).toBeVisible();
		await b.unmount();
		const hotspot = {
			hit: {
				pluginId: "points",
				ref: { kind: "feature", id: "h1" },
				refKey: "feature:h1",
				name: "Hotspot"
			},
			lngLat: [-119.7, 36.7] as [number, number]
		};
		await render(MapTooltip, {
			map: make("multiple", hotspot, monitor),
			project,
			card: true,
			actions: probe
		});
		await expect.element(page.getByText("can't select")).toBeVisible();
	});

	it("a card's toggle does nothing for a feature that can't be selected", async () => {
		const togglePick = vi.fn();
		const map = {
			...(withSelection(
				cardMap([monitorItem("a", "Site A")], { pinned: monitorHit("a", "Site A") }),
				[],
				togglePick
			) as object),
			getSelectionMode: () => "none"
		} as never;
		await render(MapTooltip, { map, project, card: true, actions: selectButton });
		await page.getByRole("button", { name: "Select" }).click();
		expect(togglePick).not.toHaveBeenCalled();
	});

	it("no actions on the hover-only tooltip", async () => {
		const map = withSelection(cardMap(sites(), { hovered: hit("a", "Site A") }), []);
		await render(MapTooltip, { map, project, actions: selectButton });
		await expect.element(page.getByRole("tooltip")).toBeVisible();
		expect(document.body.textContent).not.toContain("Select");
	});

	it("with card off, a pinned value is ignored and the tooltip keeps role=tooltip", async () => {
		await render(MapTooltip, {
			map: cardMap(sites(), { pinned: hit("a", "Site A"), focusedKey: "b" }),
			project
		});
		await expect.element(page.getByRole("tooltip")).toHaveTextContent("Site B 12.34 µg/m³ Good");
		expect(document.querySelector("[role=group]")).toBeNull();
	});
});
