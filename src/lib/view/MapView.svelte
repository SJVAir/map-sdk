<script lang="ts">
	import "@maptiler/sdk/dist/maptiler-sdk.css";
	import type { Snippet } from "svelte";
	import { untrack } from "svelte";
	import { setMapContext } from "../core/context.js";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { GlMapLike } from "../core/gl.js";
	import FeatureList from "../ui/FeatureList.svelte";
	import type { SortBy } from "../ui/feature-list.js";
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
		/** `false` leaves out the List button and its feature list panel. */
		featureList?: boolean;
	}

	let {
		map,
		active = true,
		class: className,
		label,
		overlays,
		featureList = true
	}: Props = $props();

	const uid = $props.id();
	const listId = `${uid}-list`;
	let listOpen = $state(false);
	// Kept here: the list is unmounted while closed, so it doesn't sort every feature on each move.
	let listSort = $state<SortBy>("name");
	let listButton: HTMLButtonElement | undefined = $state();

	function onListKeydown(e: KeyboardEvent) {
		if (e.key !== "Escape") return;
		e.preventDefault();
		listOpen = false;
		listButton?.focus();
	}

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
	{#if featureList}
		<div class="mapsdk-list-panel">
			<button
				bind:this={listButton}
				type="button"
				class="mapsdk-list-button"
				aria-label={map.messages("mapsdk_list_button_label")}
				aria-expanded={listOpen}
				aria-controls={listOpen ? listId : undefined}
				onclick={() => (listOpen = !listOpen)}
			>
				{map.messages("mapsdk_list_button")}
			</button>
			<!-- Escape anywhere in the panel closes it. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			{#if listOpen}
				<div onkeydown={onListKeydown}>
					<FeatureList {map} id={listId} bind:sortBy={listSort} />
				</div>
			{/if}
		</div>
	{/if}
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

	.mapsdk-list-panel {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		max-height: calc(100% - 1.5rem);
		pointer-events: none;
	}

	.mapsdk-list-panel > div {
		display: flex;
		min-height: 0;
	}

	.mapsdk-list-button {
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-card, none);
		font: inherit;
		font-size: 0.875rem;
		cursor: pointer;
		pointer-events: auto;
	}

	.mapsdk-list-button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
