<script lang="ts">
	import { onMount, untrack } from "svelte";
	import "./controls.css";
	import type { MapContext } from "../core/create-map.svelte.js";
	import { watchTheme } from "../view/create-gl-map.js";
	import LegendBar from "./LegendBar.svelte";
	import { legendSection, type LegendEntry } from "./legend-data.js";

	let {
		map,
		order = "bottom-first",
		framed = true
	}: {
		map: MapContext;
		/**
		 * `true` (default) draws the legend's own card. `false` draws no frame (no border,
		 * background, padding, or fixed width) so a host's card frames it; translucent swatches
		 * then blend over that card's color.
		 */
		framed?: boolean;
		/**
		 * `"bottom-first"` (default) lists the bottom plugin's section first; `"top-first"`
		 * last.
		 */
		order?: "bottom-first" | "top-first";
	} = $props();

	let root: HTMLElement | undefined = $state();
	// The `--background` token as rgb, for mixing translucent swatches over it. Read as soon as the
	// element exists (the bars wait for it), so no color is assumed before.
	let background = $state<string | null>(null);

	/**
	 * A section per plugin with a scale, and a status line per plugin still loading or failing, in
	 * `order`.
	 */
	const entries = $derived(
		(order === "top-first" ? [...map.plugins].reverse() : map.plugins).flatMap(
			(plugin): LegendEntry[] => {
				const data = plugin.legend?.();
				if (!data) return [];
				if ("status" in data) {
					if (data.status.state === "ready") return [];
					const layer = plugin.label ?? plugin.id;
					return [{ kind: "status", pluginId: data.pluginId, layer, status: data.status }];
				}
				const section = legendSection(data, map.format);
				return section ? [{ kind: "scale", section }] : [];
			}
		)
	);

	/**
	 * A computed color as rgb and whether it's opaque; computed colors can be oklch() or color(),
	 * and a 1x1 canvas turns any of them into rgb.
	 */
	function toRgb(css: string): { rgb: string; opaque: boolean } {
		const ctx = document.createElement("canvas").getContext("2d");
		if (!ctx) return { rgb: css, opaque: true };
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = css;
		ctx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
		return { rgb: `rgb(${r}, ${g}, ${b})`, opaque: a === 255 };
	}

	/**
	 * What translucent swatches blend over: the legend's own card, or without a frame the nearest
	 * ancestor with an opaque background (the host's card), else the `--background` token.
	 */
	function resolveBackground(el: HTMLElement, frameless: boolean): string {
		if (!frameless) return toRgb(getComputedStyle(el).backgroundColor).rgb;
		for (let at = el.parentElement; at; at = at.parentElement) {
			const color = toRgb(getComputedStyle(at).backgroundColor);
			if (color.opaque) return color.rgb;
		}
		const probe = document.createElement("div");
		probe.style.cssText = "position:absolute;visibility:hidden;background:var(--background)";
		el.append(probe);
		const token = toRgb(getComputedStyle(probe).backgroundColor).rgb;
		probe.remove();
		return token;
	}

	function update() {
		if (root) background = resolveBackground(root, !framed);
	}

	onMount(() => watchTheme(root!, update));

	// On mount, and again when `framed` changes.
	$effect(() => {
		void framed;
		untrack(update);
	});
</script>

<section
	bind:this={root}
	class={["mapsdk-legend", !framed && "mapsdk-legend-frameless"]}
	aria-label={map.messages("mapsdk_legend_label")}
	hidden={entries.length === 0}
>
	{#each entries as entry (entry.kind === "scale" ? entry.section.pluginId : entry.pluginId)}
		{#if entry.kind === "scale"}
			{@const section = entry.section}
			<div class="mapsdk-legend-section">
				<h3 class="text-sm">
					{section.title}
					{#if section.units}
						<span class="text-xs">({section.units})</span>
					{/if}
				</h3>
				{#if background !== null}
					<LegendBar bar={section.bar} {background} messages={map.messages} />
				{/if}
			</div>
		{:else}
			{@const status = entry.status}
			<div class="mapsdk-legend-status text-sm" role="status">
				{#if status.state === "loading"}
					<h3 class="text-sm">{entry.layer}</h3>
					<p>{map.messages("mapsdk_loading")}</p>
				{:else}
					<p>{map.messages("mapsdk_unavailable", { layer: entry.layer })}</p>
					{#if status.state === "error"}
						<button
							type="button"
							class="mapsdk-retry mapsdk-focus mapsdk-motion text-sm"
							onclick={() => status.retry()}
						>
							{map.messages("mapsdk_error_retry")}
						</button>
					{/if}
				{/if}
			</div>
		{/if}
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

	/* framed={false}: the host's card is the frame. */
	.mapsdk-legend-frameless {
		width: auto;
		max-width: none;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: none;
	}

	.mapsdk-legend[hidden] {
		display: none;
	}

	h3 {
		margin: 0 0 0.5rem;
		text-align: center;
		font-weight: 600;
	}

	.mapsdk-legend-status {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		text-align: center;
	}

	.mapsdk-legend-status h3 {
		margin: 0;
	}

	.mapsdk-legend-status p {
		margin: 0;
		color: var(--muted-foreground);
	}

	.mapsdk-retry {
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		font: inherit;
		cursor: pointer;
	}

	.mapsdk-retry:hover {
		background: var(--accent, var(--muted));
	}

	h3 span {
		font-weight: 400;
		color: var(--muted-foreground);
	}
</style>
