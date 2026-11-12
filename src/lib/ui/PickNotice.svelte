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
	{#if map.notice}
		{#key map.notice.id}
			<span class="mapsdk-pick-notice-text text-sm">{map.notice.message}</span>
		{/key}
	{/if}
</div>

<style>
	.mapsdk-pick-notice {
		position: absolute;
		bottom: 2.5rem;
		left: 50%;
		z-index: 3;
		max-width: calc(100% - 2rem);
		transform: translateX(-50%);
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
