<script lang="ts">
	import "./controls.css";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { GlMapLike } from "../core/gl.js";

	interface Props {
		map: MapContext;
		/** The live GL map; the zoom buttons do nothing while it is `null`. */
		gl: GlMapLike | null;
	}

	let { map, gl }: Props = $props();

	function zoomBy(delta: number) {
		if (!gl) return;
		const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		gl.easeTo({ zoom: gl.getZoom() + delta, ...(reduced && { duration: 0 }) });
	}
</script>

<div class="mapsdk-zoom" role="group" aria-label={map.messages("mapsdk_controls_label")}>
	<button type="button" class="mapsdk-focus mapsdk-motion" disabled={!gl} onclick={() => zoomBy(1)}>
		<span class="mapsdk-zoom-icon" aria-hidden="true">+</span>
		<span class="mapsdk-sr">{map.messages("mapsdk_zoom_in")}</span>
		<span class="mapsdk-zoom-tip mapsdk-motion text-xs" aria-hidden="true"
			>{map.messages("mapsdk_zoom_in")}</span
		>
	</button>
	<button
		type="button"
		class="mapsdk-focus mapsdk-motion"
		disabled={!gl}
		onclick={() => zoomBy(-1)}
	>
		<span class="mapsdk-zoom-icon" aria-hidden="true">&minus;</span>
		<span class="mapsdk-sr">{map.messages("mapsdk_zoom_out")}</span>
		<span class="mapsdk-zoom-tip mapsdk-motion text-xs" aria-hidden="true"
			>{map.messages("mapsdk_zoom_out")}</span
		>
	</button>
</div>

<style>
	.mapsdk-zoom {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 2;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		box-shadow: var(--shadow-card, none);
		pointer-events: auto;
	}

	.mapsdk-zoom button {
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--foreground);
		font: inherit;
		cursor: pointer;
	}

	.mapsdk-zoom button + button {
		border-top: 1px solid var(--card-border, var(--border));
	}

	.mapsdk-zoom button:disabled {
		color: var(--muted-foreground);
		cursor: default;
	}

	.mapsdk-zoom button {
		position: relative;
	}

	/* The hover fill follows the group's rounded corners. */
	.mapsdk-zoom button:first-child {
		border-radius: var(--radius-control, var(--radius)) var(--radius-control, var(--radius)) 0 0;
	}

	.mapsdk-zoom button:last-child {
		border-radius: 0 0 var(--radius-control, var(--radius)) var(--radius-control, var(--radius));
	}

	.mapsdk-zoom button:hover:not(:disabled) {
		background: var(--accent, var(--muted));
	}

	/* Above the next button, so the ring isn't cut by it. */
	.mapsdk-zoom button:focus-visible {
		z-index: 1;
	}

	/* The visible name: on hover and focus, left of the button; the screen-reader text stays. */
	.mapsdk-zoom-tip {
		position: absolute;
		top: 50%;
		right: calc(100% + 0.5rem);
		padding: 0.125rem 0.5rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--popover, var(--background));
		color: var(--popover-foreground, var(--foreground));
		box-shadow: var(--shadow-lifted, var(--shadow-card, none));
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transform: translateY(-50%);
	}

	.mapsdk-zoom button:hover .mapsdk-zoom-tip,
	.mapsdk-zoom button:focus-visible .mapsdk-zoom-tip {
		opacity: 1;
	}

	.mapsdk-zoom-icon {
		font-size: 1.25rem;
		line-height: 1;
	}

	.mapsdk-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
