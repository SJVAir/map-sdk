<script lang="ts">
	import type { OptionIcon } from "./types.js";

	let { icon }: { icon: OptionIcon } = $props();
</script>

<span class="mapsdk-option-icon" aria-hidden="true">
	{#if typeof icon === "function"}
		{@render icon()}
	{:else}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- marker SVG from map-sdk's shapes or the host's own declarations, never user text -->
		{@html icon.svg}
	{/if}
</span>

<style>
	.mapsdk-option-icon {
		display: inline-flex;
		width: 1.25rem;
		height: 1.25rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
	}

	.mapsdk-option-icon :global(svg) {
		max-width: 100%;
		max-height: 100%;
	}
</style>
