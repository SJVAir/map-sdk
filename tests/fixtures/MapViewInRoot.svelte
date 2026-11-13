<script lang="ts">
	import MapView from "../../src/lib/view/MapView.svelte";
	import OptionsToolbar from "../../src/lib/options/OptionsToolbar.svelte";
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
	import type { ToolbarState } from "./options.svelte.js";

	let {
		map,
		state: options,
		rootClass = "root-1024",
		mapClass = "map-683",
		useRoot = true,
		altRoot = false,
		altShown = true,
		altClass = "root-600",
		secondMap
	}: {
		map: MapContext;
		state: ToolbarState;
		rootClass?: string;
		mapClass?: string;
		useRoot?: boolean;
		altRoot?: boolean;
		altShown?: boolean;
		altClass?: string;
		/** A second map in the same root, with no layoutRoot. */
		secondMap?: MapContext;
	} = $props();

	let shell = $state<HTMLDivElement>();
	let alt = $state<HTMLDivElement>();
	const layoutRoot = $derived(useRoot ? ((altRoot ? alt : shell) ?? null) : null);
</script>

{#snippet toolbar()}
	{#if options.shown}
		<OptionsToolbar
			groups={options.groups}
			values={options.values}
			defaults={options.defaults}
			readonly={options.readonly}
			onchange={options.onchange}
		/>
	{/if}
{/snippet}

<div bind:this={shell} class={["layout-root", rootClass]} style="display: flex">
	<MapView {map} class={mapClass} featureList={false} {layoutRoot} {toolbar} />
	{#if secondMap}
		<MapView map={secondMap} class={mapClass} featureList={false} {toolbar} />
	{/if}
	<div style="flex: 1"></div>
</div>
{#if altShown}
	<div bind:this={alt} class={["alt-root", altClass]}></div>
{/if}
