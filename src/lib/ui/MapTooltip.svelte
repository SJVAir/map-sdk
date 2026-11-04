<script lang="ts">
	import { untrack } from "svelte";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { FeatureListItem, MapPlugin } from "../core/plugin.js";
	import { NO_LEVEL } from "../data/scale.js";
	import { levelChip } from "./level-chip.js";

	interface Props {
		map: MapContext;
		/**
		 * Canvas pixel for a position, or `null` while there is no GL map. Reactive: it should
		 * read something that changes when the camera moves, so the tooltip follows the map.
		 */
		project: (lngLat: [number, number]) => { x: number; y: number } | null;
		/** The map container's size; the tooltip stays inside it. Unset: no clamping. */
		width?: number;
		height?: number;
	}

	let { map, project, width, height }: Props = $props();

	let tipWidth = $state(0);
	let tipHeight = $state(0);
	const GAP = 12;

	// The keyboard-focused list item wins over the pointer.
	const key = $derived(map.focusedKey ?? map.hovered?.hit.refKey ?? null);
	// Primitives, so moving the pointer within one feature doesn't recompute the content.
	const hitPluginId = $derived(map.focusedKey ? null : (map.hovered?.hit.pluginId ?? null));
	const hitName = $derived(map.focusedKey ? null : (map.hovered?.hit.name ?? null));

	// Reads only the shown feature's plugin (or all plugins for a focused key), and only while
	// something is shown, so an idle map doesn't subscribe to any plugin's data.
	const found = $derived.by((): { item: FeatureListItem; plugin: MapPlugin } | null => {
		if (key === null) return null;
		// The hovered hit's plugin, or the focused one; without either, the first plugin listing the key.
		const pluginId = hitPluginId ?? map.focusedPluginId;
		const plugins = pluginId ? map.plugins.filter((p) => p.id === pluginId) : map.plugins;
		for (const plugin of plugins) {
			const item = plugin.features?.().find((f) => f.refKey === key);
			if (item) return { item, plugin };
		}
		return null;
	});

	const item = $derived(found?.item ?? null);
	const name = $derived(item?.name ?? hitName);
	// A found item anchors the tooltip at its point (stable while the pointer moves over it).
	const anchor = $derived(item?.lngLat ?? map.hovered?.lngLat ?? null);
	const projected = $derived(anchor ? project(anchor) : null);
	// Centered above the point; flipped below it near the top edge; inside the container.
	const position = $derived.by(() => {
		if (!projected) return null;
		let { x, y } = projected;
		if (width)
			x = Math.min(Math.max(x, tipWidth / 2), Math.max(width - tipWidth / 2, tipWidth / 2));
		let top = y - tipHeight - GAP;
		if (top < 0) top = y + GAP;
		if (height) top = Math.min(top, Math.max(height - tipHeight, 0));
		return { left: x - tipWidth / 2, top: Math.max(top, 0) };
	});
	const custom = $derived.by(() => {
		if (found) return found.plugin.tooltip?.(found.item);
		// A hovered hit no plugin lists (e.g. a cluster bubble): its plugin's hover content.
		if (key === null || hitPluginId === null) return undefined;
		const plugin = map.plugins.find((p) => p.id === hitPluginId);
		const hit = untrack(() => map.hovered?.hit);
		return hit && plugin?.hoverTooltip?.(hit);
	});

	// A level with an empty color shows its label on the neutral chip.
	const level = $derived(item && item.level !== NO_LEVEL ? item.level : null);
	const levelLabel = $derived(level ? level.label : map.messages("mapsdk_no_level"));
	const chipColors = $derived.by(() => {
		const chip = levelChip(level?.color);
		return chip ? `background:${chip.background};color:${chip.text}` : "";
	});
	const valueText = $derived(
		item?.value == null
			? null
			: typeof item.value === "number"
				? map.format.number(item.value)
				: item.value
	);
</script>

<!-- Only with something to show: a hit with no name, item, or content gets no empty box. -->
{#if (name || item || custom) && position}
	<div
		class="mapsdk-tooltip text-sm"
		role="tooltip"
		bind:offsetWidth={tipWidth}
		bind:offsetHeight={tipHeight}
		style:left="{position.left}px"
		style:top="{position.top}px"
	>
		{#if name}
			<div class="mapsdk-tooltip-name">{name}</div>
		{/if}
		{#if custom}
			{@render custom()}
		{:else if item}
			{#if valueText !== null}
				<div class="mapsdk-tooltip-value">
					{valueText}{#if item.units}&nbsp;{item.units}{/if}
				</div>
			{/if}
			<span class="mapsdk-tooltip-chip text-xs" class:neutral={!chipColors} style={chipColors}>
				{levelLabel}
			</span>
		{/if}
	</div>
{/if}

<style>
	.mapsdk-tooltip {
		position: absolute;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		max-width: 16rem;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--popover, var(--background));
		color: var(--popover-foreground, var(--foreground));
		box-shadow: var(--shadow-lifted, var(--shadow-card, none));
		pointer-events: none;
	}

	.mapsdk-tooltip-name {
		font-weight: 600;
	}

	.mapsdk-tooltip-chip {
		padding: 0.0625rem 0.5rem;
		border: var(--swatch-outline-width, 1px) solid
			var(--swatch-outline-color, color-mix(in srgb, var(--foreground) 75%, var(--background)));
		border-radius: 999px;
	}

	.mapsdk-tooltip-chip.neutral {
		background: var(--muted);
		color: var(--muted-foreground);
	}
</style>
