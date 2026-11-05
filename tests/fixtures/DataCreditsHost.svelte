<script lang="ts">
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
	import { createDataCredits } from "../../src/lib/ui/data-credits.svelte.js";

	let { map }: { map: MapContext } = $props();
	// svelte-ignore state_referenced_locally
	const credits = createDataCredits(map);
</script>

<ul>
	{#each credits.list as credit (credit)}
		<li>{credit}</li>
	{/each}
</ul>
