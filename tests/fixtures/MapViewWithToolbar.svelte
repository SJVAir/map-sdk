<script lang="ts">
	import MapView from "../../src/lib/view/MapView.svelte";
	import OptionsToolbar from "../../src/lib/options/OptionsToolbar.svelte";
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
	import type { FeatureListOptions } from "../../src/lib/view/list-placement.js";
	import type { ToolbarState } from "./options.svelte.js";

	let {
		map,
		state,
		class: className = "wide-map",
		featureList = true,
		withToolbar = true
	}: {
		map: MapContext;
		state: ToolbarState;
		class?: string;
		featureList?: boolean | FeatureListOptions;
		withToolbar?: boolean;
	} = $props();
</script>

{#snippet toolbar()}
	{#if state.shown}
		<OptionsToolbar
			groups={state.groups}
			values={state.values}
			defaults={state.defaults}
			readonly={state.readonly}
			onchange={state.onchange}
		/>
	{/if}
{/snippet}

<MapView {map} class={className} {featureList} toolbar={withToolbar ? toolbar : undefined} />
