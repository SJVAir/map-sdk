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
		withToolbar = true,
		searchWidth
	}: {
		map: MapContext;
		state: ToolbarState;
		class?: string;
		featureList?: boolean | FeatureListOptions;
		withToolbar?: boolean;
		/** Renders a search field of this CSS width (capped at 22.5rem) in the search slot. */
		searchWidth?: string;
	} = $props();
</script>

{#snippet search()}
	<input
		type="search"
		aria-label="Search"
		data-test-search
		style="box-sizing: border-box; width: {searchWidth}; max-width: 22.5rem"
	/>
{/snippet}

{#snippet toolbar()}
	{#if state.shown}
		<OptionsToolbar
			groups={state.groups}
			values={state.values}
			defaults={state.defaults}
			readonly={state.readonly}
			onchange={state.onchange}
			search={searchWidth ? search : undefined}
		/>
	{/if}
{/snippet}

<MapView {map} class={className} {featureList} toolbar={withToolbar ? toolbar : undefined} />
