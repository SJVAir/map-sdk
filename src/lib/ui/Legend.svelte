<script lang="ts">
	import { onMount } from "svelte";
	import type { MapContext } from "../core/create-map.svelte.js";
	import { watchTheme } from "../view/create-gl-map.js";
	import LegendBar from "./LegendBar.svelte";
	import { legendSection } from "./legend-data.js";

	let { map }: { map: MapContext } = $props();

	let root: HTMLElement | undefined = $state();
	// The `--background` token as rgb, for mixing translucent swatches over it. Read as soon as the
	// element exists (the bars wait for it), so no color is assumed before.
	let background = $state<string | null>(null);

	const sections = $derived(
		map.plugins.flatMap((plugin) => {
			const data = plugin.legend?.();
			const section = data ? legendSection(data, map.format) : null;
			return section ? [section] : [];
		})
	);

	/** Computed colors can be oklch() or color(); a 1x1 canvas turns any of them into rgb. */
	function resolveBackground(el: Element): string {
		const css = getComputedStyle(el).backgroundColor;
		const ctx = document.createElement("canvas").getContext("2d");
		if (!ctx) return css;
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = css;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
		return `rgb(${r}, ${g}, ${b})`;
	}

	onMount(() => {
		const update = () => {
			if (root) background = resolveBackground(root);
		};
		update();
		return watchTheme(root!, update);
	});
</script>

<section
	bind:this={root}
	class="mapsdk-legend"
	aria-label={map.messages("mapsdk_legend_label")}
	hidden={sections.length === 0}
>
	{#each sections as section (section.pluginId)}
		<div class="mapsdk-legend-section">
			<h3>
				{section.title}
				{#if section.units}
					<span>({section.units})</span>
				{/if}
			</h3>
			{#if background !== null}
				<LegendBar bar={section.bar} {background} messages={map.messages} />
			{/if}
		</div>
	{/each}
</section>

<style>
	.mapsdk-legend {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 21rem;
		max-width: calc(100vw - 2rem);
		box-sizing: border-box;
		padding: 0.75rem 1rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-card, none);
		pointer-events: auto;
	}

	.mapsdk-legend[hidden] {
		display: none;
	}

	h3 {
		margin: 0 0 0.5rem;
		text-align: center;
		font-size: var(--text-sm, 0.875rem);
		font-weight: 600;
	}

	h3 span {
		font-size: var(--text-xs, 0.75rem);
		font-weight: 400;
		color: var(--muted-foreground);
	}
</style>
