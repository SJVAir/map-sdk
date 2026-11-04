<script lang="ts">
	import "@maptiler/sdk/dist/maptiler-sdk.css";
	import type { Snippet } from "svelte";
	import { untrack } from "svelte";
	import { setMapContext } from "../core/context.js";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { GlMapLike } from "../core/gl.js";
	import MapTooltip from "../ui/MapTooltip.svelte";
	import { createGlMap, watchTheme } from "./create-gl-map.js";

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

	let root: HTMLDivElement;
	let glContainer: HTMLDivElement;
	// The live GL map and a counter bumped on every camera move or resize: the tooltip's `project` reads
	// both, so it re-runs (and follows its feature) as the map moves.
	let projector = $state.raw<GlMapLike | null>(null);
	let moves = $state(0);
	let width = $state(0);
	let height = $state(0);

	function project(lngLat: [number, number]) {
		void moves;
		return projector ? projector.project(lngLat) : null;
	}

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
		const onMove = () => moves++;
		gl.on("move", onMove);
		gl.on("resize", onMove);
		projector = gl;
		// Plugins bake theme colors into paint and images, so they set up again on a change.
		const stopTheme = watchTheme(root, () => ctx.themeChanged());
		return () => {
			stopTheme();
			projector = null;
			gl.off("move", onMove);
			gl.off("resize", onMove);
			try {
				ctx.detach();
			} finally {
				gl.remove();
			}
		};
	});
</script>

<div
	bind:this={root}
	bind:clientWidth={width}
	bind:clientHeight={height}
	class={["mapsdk-map", className]}
	role="region"
	aria-label={label ?? map.messages("mapsdk_map_label")}
	data-mapsdk-map={map.uid}
>
	<div class="mapsdk-gl" bind:this={glContainer}></div>
	<MapTooltip {map} {project} {width} {height} />
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
