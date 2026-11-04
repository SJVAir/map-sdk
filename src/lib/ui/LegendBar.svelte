<script lang="ts">
	import type { MessageProvider } from "../data/messages.js";
	import { swatchOverBackground, type LegendBar } from "./legend-data.js";

	interface Props {
		bar: LegendBar;
		/** The page background as a color color2k can parse. */
		background: string;
		messages: MessageProvider;
	}

	let { bar, background, messages }: Props = $props();

	// An empty color (a level with none) gets a neutral swatch rather than nothing.
	const NEUTRAL = "var(--muted-foreground)";

	const items = $derived(
		bar.kind === "gradient"
			? bar.stops.map((stop) => ({
					color: stop.color || NEUTRAL,
					label: stop.label,
					// The ticks are aria-hidden, so their numbers reach screen readers here.
					threshold: stop.tick ? messages("mapsdk_legend_threshold", { value: stop.tick }) : ""
				}))
			: bar.blocks.map((block) => ({
					color: block.color
						? swatchOverBackground(block.color, block.opacity, background)
						: NEUTRAL,
					label: block.label,
					threshold: ""
				}))
	);

	const gradient = $derived(
		bar.kind === "gradient" && bar.stops.length > 0
			? bar.stops.length === 1
				? items[0].color
				: `linear-gradient(to right, ${items.map((item) => item.color).join(", ")})`
			: null
	);
</script>

{#if bar.kind === "gradient" && gradient}
	<div class="mapsdk-legend-gradient" style:background={gradient} aria-hidden="true"></div>
	<div class="mapsdk-legend-ticks" aria-hidden="true">
		{#each bar.stops as stop, i (i)}
			<span>{stop.tick}</span>
		{/each}
	</div>
{/if}
<ul class="mapsdk-legend-items">
	{#each items as item, i (i)}
		<li>
			<span class="mapsdk-legend-swatch" style:background={item.color}></span>
			<span>{item.label}</span>
			{#if item.threshold}<span class="mapsdk-legend-threshold">{item.threshold}</span>{/if}
		</li>
	{/each}
</ul>

<style>
	.mapsdk-legend-gradient {
		height: 0.75rem;
		border-radius: 0.25rem;
		outline: 1px solid color-mix(in srgb, var(--foreground) 75%, var(--background));
		outline-offset: 1px;
	}

	.mapsdk-legend-ticks {
		display: flex;
		justify-content: space-between;
		margin-top: 0.375rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}

	.mapsdk-legend-items {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.75rem;
	}

	/* Visually hidden, read after the label. */
	.mapsdk-legend-threshold {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.mapsdk-legend-items li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* The outline sits 1px off the swatch, over the background, so it needs 3:1 against the
	   background only; the gap keeps a swatch near the outline's own color readable. */
	.mapsdk-legend-swatch {
		width: 0.875rem;
		height: 0.875rem;
		flex: none;
		border-radius: 0.125rem;
		outline: 1px solid color-mix(in srgb, var(--foreground) 75%, var(--background));
		outline-offset: 1px;
	}
</style>
