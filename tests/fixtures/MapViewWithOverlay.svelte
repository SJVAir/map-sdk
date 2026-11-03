<script lang="ts">
	import MapView from "../../src/lib/view/MapView.svelte";
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
	import MapContextProbe from "./MapContextProbe.svelte";

	let { map }: { map: MapContext } = $props();
</script>

<MapView {map} class="test-map">
	{#snippet overlays()}
		<MapContextProbe />
	{/snippet}
</MapView>
