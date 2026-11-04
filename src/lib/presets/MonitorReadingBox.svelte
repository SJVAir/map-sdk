<script lang="ts">
	import { levelChip } from "../ui/level-chip.js";

	// monitor-map's DataBox: a reading in a box filled with its level's color.

	interface Props {
		/** The level color; null or unparseable → the neutral box. */
		color: string | null;
		header: string;
		value: string;
		/** Shows `value` large (a reading rather than a "No reading" note). */
		large: boolean;
		subheading?: string;
	}

	let { color, header, value, large, subheading }: Props = $props();

	const style = $derived.by(() => {
		const chip = levelChip(color);
		return chip
			? `background:${chip.background};border-color:${chip.border};color:${chip.text}`
			: "";
	});
</script>

<div class="mapsdk-reading-box" class:neutral={!style} {style}>
	{#if header}
		<span class="text-base">{header}</span>
	{/if}
	<span class="mapsdk-reading-value" class:text-3xl={large}>{value}</span>
	{#if subheading}
		<span>{subheading}</span>
	{/if}
</div>

<style>
	.mapsdk-reading-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border: 4px solid;
		border-radius: calc(var(--radius-control, var(--radius)) / 2);
		text-align: center;
		white-space: nowrap;
	}

	.mapsdk-reading-box.neutral {
		border-color: var(--border);
		background: var(--muted);
		color: var(--muted-foreground);
	}

	.mapsdk-reading-value {
		font-weight: 700;
	}
</style>
