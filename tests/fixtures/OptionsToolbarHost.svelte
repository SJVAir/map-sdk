<script lang="ts">
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
	import OptionsToolbar from "../../src/lib/options/OptionsToolbar.svelte";
	import type { ToolbarState } from "./options.svelte.js";

	/** `focusable`: wraps everything in a focusable `<main>`, as sjvair.com and the dashboard do. */
	let { map, state, focusable }: { map: MapContext; state: ToolbarState; focusable?: "-1" | "0" } =
		$props();
</script>

{#snippet content()}
	<div data-testid="outside" style="height: 40px">outside</div>
	<OptionsToolbar
		{map}
		groups={state.groups}
		values={state.values}
		defaults={state.defaults}
		readonly={state.readonly}
		basemapKey={state.basemapKey}
		onchange={state.onchange}
	/>
{/snippet}

{#if focusable}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<main tabindex={Number(focusable)}>{@render content()}</main>
{:else}
	{@render content()}
{/if}
