<script lang="ts">
	import { readableColor } from "color2k";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { FeatureListItem, MapPlugin } from "../core/plugin.js";
	import { NO_LEVEL } from "../data/scale.js";

	interface Props {
		map: MapContext;
		/**
		 * Canvas pixel for a position, or `null` while there is no GL map. Reactive: it should
		 * read something that changes when the camera moves, so the tooltip follows the map.
		 */
		project: (lngLat: [number, number]) => { x: number; y: number } | null;
	}

	let { map, project }: Props = $props();

	// The keyboard-focused list item wins over the pointer.
	const key = $derived(map.focusedKey ?? map.hovered?.hit.refKey ?? null);
	const hit = $derived(map.focusedKey ? null : (map.hovered?.hit ?? null));

	// Reads only the shown feature's plugin (or all plugins for a focused key), and only while
	// something is shown, so an idle map doesn't subscribe to any plugin's data.
	const found = $derived.by((): { item: FeatureListItem; plugin: MapPlugin } | null => {
		if (key === null) return null;
		const plugins = hit ? map.plugins.filter((p) => p.id === hit.pluginId) : map.plugins;
		for (const plugin of plugins) {
			const item = plugin.features?.().find((f) => f.refKey === key);
			if (item) return { item, plugin };
		}
		return null;
	});

	const item = $derived(found?.item ?? null);
	const name = $derived(item?.name ?? hit?.name ?? null);
	// A found item anchors the tooltip at its point (stable while the pointer moves over it).
	const anchor = $derived(item?.lngLat ?? map.hovered?.lngLat ?? null);
	const position = $derived(anchor ? project(anchor) : null);
	const custom = $derived(found ? found.plugin.tooltip?.(found.item) : undefined);

	const level = $derived(item && item.level !== NO_LEVEL && item.level.color ? item.level : null);
	const levelLabel = $derived(level ? level.label : map.messages("mapsdk_no_level"));
	const chipColors = $derived(level ? chipStyle(level.color) : "");
	const valueText = $derived(
		item?.value == null
			? null
			: typeof item.value === "number"
				? map.format.number(item.value)
				: item.value
	);

	/** Background and a readable text color; an unparseable color falls back to the neutral chip. */
	function chipStyle(color: string): string {
		try {
			return `background:${color};color:${readableColor(color)}`;
		} catch {
			return "";
		}
	}
</script>

{#if name !== null && position}
	<div class="mapsdk-tooltip" role="tooltip" style:left="{position.x}px" style:top="{position.y}px">
		<div class="mapsdk-tooltip-name">{name}</div>
		{#if custom}
			{@render custom()}
		{:else if item}
			{#if valueText !== null}
				<div class="mapsdk-tooltip-value">
					{valueText}{#if item.units}&nbsp;{item.units}{/if}
				</div>
			{/if}
			<span class="mapsdk-tooltip-chip" class:neutral={!chipColors} style={chipColors}>
				{levelLabel}
			</span>
		{/if}
	</div>
{/if}

<style>
	.mapsdk-tooltip {
		position: absolute;
		z-index: 1;
		transform: translate(-50%, calc(-100% - 0.75rem));
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
		box-shadow: var(--shadow-card, none);
		font-size: 0.875rem;
		pointer-events: none;
	}

	.mapsdk-tooltip-name {
		font-weight: 600;
	}

	.mapsdk-tooltip-chip {
		padding: 0.0625rem 0.5rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: 999px;
		font-size: 0.75rem;
	}

	.mapsdk-tooltip-chip.neutral {
		background: var(--muted);
		color: var(--muted-foreground);
	}
</style>
