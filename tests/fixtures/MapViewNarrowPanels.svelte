<script lang="ts">
	import MapView from "../../src/lib/view/MapView.svelte";
	import Legend from "../../src/lib/ui/Legend.svelte";
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";

	let { map }: { map: MapContext } = $props();
</script>

<MapView {map} class="narrow-map">
	{#snippet overlays()}
		<Legend {map} />
	{/snippet}
</MapView>
