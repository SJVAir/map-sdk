<script lang="ts">
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
	import SelectionBar from "../../src/lib/ui/SelectionBar.svelte";

	let {
		map,
		list = true,
		width = 320
	}: { map: MapContext; list?: boolean; width?: number } = $props();
</script>

<div
	class="host"
	data-mapsdk-map={map.uid}
	role="region"
	aria-label="host"
	style:width="{width}px"
	style:height="200px"
	style:position="relative"
>
	{#if list}
		<button type="button" class="mapsdk-list-button">List</button>
	{/if}
	<SelectionBar {map} />
</div>
