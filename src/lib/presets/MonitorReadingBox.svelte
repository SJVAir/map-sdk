<script lang="ts">
	import type { MessageProvider } from "../data/messages.js";
	import { levelChip } from "../ui/level-chip.js";

	// monitor-map's DataBox: a reading in a box filled with its level's color. Each line under the
	// value starts with a pause only screen readers get, so "12" and "24-hour average" aren't heard
	// as one number.

	interface Props {
		/** The level color; null or unparseable → the neutral box. */
		color: string | null;
		header: string;
		value: string;
		/** Shows `value` large (a reading rather than a "No reading" note). */
		large: boolean;
		/** What the figure is (e.g. "24-hour average"), on its own line above `subheading`. */
		figure?: string;
		subheading?: string;
		messages: MessageProvider;
	}

	let { color, header, value, large, figure, subheading, messages }: Props = $props();

	const notes = $derived([figure, subheading].filter((note): note is string => !!note));

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
	{#each notes as note, i (i)}
		<span class="mapsdk-reading-pause">{messages("mapsdk_reading_pause")}</span>
		<span>{note}</span>
	{/each}
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

	/* Heard by screen readers, never seen. */
	.mapsdk-reading-pause {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	.mapsdk-reading-value {
		font-weight: 700;
	}
</style>
