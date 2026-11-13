<script lang="ts">
	import type { MapContext } from "../../src/lib/core/create-map.svelte.js";
	import OptionsToolbar from "../../src/lib/options/OptionsToolbar.svelte";
	import type { ToolbarState } from "./options.svelte.js";

	let { map, state }: { map: MapContext; state: ToolbarState } = $props();
</script>

<div data-testid="outside" style="height: 40px">outside</div>
<OptionsToolbar
	{map}
	groups={state.groups}
	values={state.values}
	defaults={state.defaults}
	readonly={state.readonly}
	onchange={state.onchange}
/>
