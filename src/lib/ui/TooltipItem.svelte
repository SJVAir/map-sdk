<script lang="ts">
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";
	import type { FeatureListItem } from "../core/plugin.js";
	import { NO_LEVEL } from "../data/scale.js";
	import { levelChip } from "./level-chip.js";
	import { formatValue } from "./value-format.js";

	// The generic tooltip body under a feature's name: its value and a chip with its level. Shared
	// by MapTooltip and by plugins that show it for features they don't list.

	interface Props {
		item: FeatureListItem;
		messages: MessageProvider;
		format: FormatProvider;
	}

	let { item, messages, format }: Props = $props();

	// A level with an empty color shows its label on the neutral chip.
	const level = $derived(item.level !== NO_LEVEL ? item.level : null);
	const levelLabel = $derived(level ? level.label : messages("mapsdk_no_level"));
	const chipColors = $derived.by(() => {
		const chip = levelChip(level?.color);
		return chip ? `background:${chip.background};color:${chip.text}` : "";
	});
	const valueText = $derived(
		item.value == null
			? null
			: typeof item.value === "number"
				? formatValue(item.value, item.precision, format)
				: item.value
	);
</script>

<div class="mapsdk-tooltip-item">
	{#if valueText !== null}
		<div class="mapsdk-tooltip-value">
			{valueText}{#if item.units}&nbsp;{item.units}{/if}
		</div>
	{/if}
	<span class="mapsdk-tooltip-chip text-xs" class:neutral={!chipColors} style={chipColors}>
		{levelLabel}
	</span>
</div>

<style>
	.mapsdk-tooltip-item {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
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
