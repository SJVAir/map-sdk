<script lang="ts">
	import type { MapContext } from "../core/create-map.svelte.js";

	interface Props {
		map: MapContext;
	}

	let { map }: Props = $props();

	/** How long a refused pick's message stays. */
	const SHOW_MS = 4000;

	// Each refusal (a new id) shows for SHOW_MS, then clears.
	$effect(() => {
		const id = map.notice?.id;
		if (id === undefined) return;
		const timer = setTimeout(() => {
			if (map.notice?.id === id) map.clearNotice();
		}, SHOW_MS);
		return () => clearTimeout(timer);
	});
</script>

<!-- Always present: a live region must exist before its text changes to be announced. -->
<div class="mapsdk-pick-notice" role="status" aria-live="polite" aria-atomic="true">
	{#if map.notice?.message}
		{#key map.notice.id}
			<span class="mapsdk-pick-notice-text text-sm">{map.notice.message}</span>
		{/key}
	{/if}
</div>

<style>
	/* Spans the map less 1rem a side, centering its text box, so a long message wraps at the
	   map's width rather than at half of it. */
	.mapsdk-pick-notice {
		position: absolute;
		right: 1rem;
		bottom: 2.5rem;
		left: 1rem;
		z-index: 3;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}

	.mapsdk-pick-notice-text {
		display: block;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-card, none);
	}
</style>
