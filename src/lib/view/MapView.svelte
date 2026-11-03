<script lang="ts">
	import "@maptiler/sdk/dist/maptiler-sdk.css";
	import type { Snippet } from "svelte";
	import { untrack } from "svelte";
	import { setMapContext } from "../core/context.js";
	import type { MapContext } from "../core/create-map.svelte.js";
	import { createGlMap } from "./create-gl-map.js";

	interface Props {
		/** The map to show. Fixed for the component's life. */
		map: MapContext;
		/** `false` releases the WebGL context; `true` rebuilds it with the same camera. */
		active?: boolean;
		class?: string;
		/** The region's accessible name. Defaults to the `mapsdk_map_label` message. */
		label?: string;
		/** On-screen pieces drawn over the map; they get the map through `getMapContext()`. */
		overlays?: Snippet;
	}

	let { map, active = true, class: className, label, overlays }: Props = $props();

	// The map is fixed for the component's life, so its first value is the one to provide.
	// svelte-ignore state_referenced_locally
	setMapContext(map);

	let glContainer: HTMLDivElement;

	$effect(() => {
		if (!active) return;
		const ctx = map;
		const gl = untrack(() => {
			const gl = createGlMap(glContainer, ctx);
			try {
				ctx.attach(gl);
			} catch (error) {
				gl.remove();
				throw error;
			}
			return gl;
		});
		return () => {
			try {
				ctx.detach();
			} finally {
				gl.remove();
			}
		};
	});
</script>

<div
	class={["mapsdk-map", className]}
	role="region"
	aria-label={label ?? map.messages("mapsdk_map_label")}
	data-mapsdk-map={map.uid}
>
	<div class="mapsdk-gl" bind:this={glContainer}></div>
	{@render overlays?.()}
</div>

<style>
	.mapsdk-map {
		position: relative;
	}

	.mapsdk-gl {
		position: absolute;
		inset: 0;
	}
</style>
