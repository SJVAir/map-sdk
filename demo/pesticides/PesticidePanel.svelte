<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import { Legend, MapView, type CardContext } from "../../src/lib/index.js";
	import { createPesticideMap } from "./pesticide-map.js";

	let { maptilerKey, onready }: { maptilerKey: string; onready?: (exposed: object) => void } =
		$props();

	// Made once: the key and the callback are read at creation, as the demo's other maps do.
	const { map, lens, townships, noticeTotal } = untrack(() =>
		createPesticideMap(maptilerKey, legendNote)
	);
	untrack(() => onready?.({ map, lens, noticeTotal }));

	function zoomIn(ctx: CardContext) {
		const at = ctx.item?.lngLat;
		if (at) map.flyTo({ center: at, zoom: 11.5 });
	}

	onDestroy(() => map.destroy());
</script>

{#snippet legendNote()}
	<p class="demo-note">
		Made-up pounds of active ingredient, for the demo. Hover a township to see its square miles.
		<a href="#about-pesticides">About this data</a>
	</p>
{/snippet}

{#snippet actions(ctx: CardContext)}
	{#if ctx.pluginId === townships.id}
		<button type="button" class="demo-button text-sm" onclick={() => lens.pin(ctx.refKey)}>
			Show square miles
		</button>
		<button type="button" class="demo-button text-sm" onclick={() => zoomIn(ctx)}>Zoom in</button>
	{/if}
{/snippet}

<MapView {map} label="Pesticide map" class="demo-map" card={{ actions }} featureList />
<Legend {map} />

<style>
	.demo-note {
		margin: 0;
	}
	.demo-note a {
		color: var(--primary);
		text-decoration: underline;
	}
	.demo-button {
		padding: 0.125rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		background: var(--background);
		color: var(--foreground);
	}
</style>
