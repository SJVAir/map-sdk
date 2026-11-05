<script lang="ts">
	import "@maptiler/sdk/dist/maptiler-sdk.css";
	import "../ui/controls.css";
	import { DEV } from "esm-env";
	import type { Snippet } from "svelte";
	import { untrack } from "svelte";
	import { setMapContext } from "../core/context.js";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { GlMapLike } from "../core/gl.js";
	import FeatureList from "../ui/FeatureList.svelte";
	import type { SortBy } from "../ui/feature-list.js";
	import MapControls from "../ui/MapControls.svelte";
	import MapTooltip from "../ui/MapTooltip.svelte";
	import SelectionBar from "../ui/SelectionBar.svelte";
	import ViewSummary from "../ui/ViewSummary.svelte";
	import { createDataCredits } from "../ui/data-credits.svelte.js";
	import { createGlMap, setDataCredits, watchTheme } from "./create-gl-map.js";

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
		/** `false` leaves out the selection bar. */
		selectionBar?: boolean;
		/**
		 * The zoom controls: `"mapsdk"` (default) draws map-sdk's zoom buttons, `"engine"` the
		 * engine's zoom, compass, and locate-me buttons, `"none"` none. The credits always show.
		 */
		controls?: "mapsdk" | "engine" | "none";
		/**
		 * `"pinned"` (default) anchors the tooltip to its feature. `"pointer"` shows it at the
		 * pointer, like sjvair.com's map, and hides it on zoom until the pointer moves again.
		 * Keyboard focus from the feature list always shows it pinned.
		 */
		tooltip?: "pinned" | "pointer";
	}

	let {
		map,
		active = true,
		class: className,
		label,
		overlays,
		featureList = true,
		selectionBar = true,
		controls = "mapsdk",
		tooltip = "pinned"
	}: Props = $props();

	const uid = $props.id();
	const listId = `${uid}-list`;
	let listOpen = $state(false);
	// Kept here: the list is unmounted while closed, so it doesn't sort every feature on each move.
	let listSort = $state<SortBy>("name");
	let listButton: HTMLButtonElement | undefined = $state();
	let listBox: HTMLDivElement | undefined = $state();
	let listWidth = $state(0);

	// The open panel's right edge, so focusing a feature pans it clear of the list.
	$effect(() => {
		const box = listOpen ? listBox : undefined;
		void listWidth;
		if (!box) {
			map.setListInset(0);
			return;
		}
		map.setListInset(box.getBoundingClientRect().right - root.getBoundingClientRect().left);
	});

	function onListKeydown(e: KeyboardEvent) {
		if (e.key !== "Escape") return;
		e.preventDefault();
		listOpen = false;
		listButton?.focus();
	}

	// The map is fixed for the component's life, so its first value is the one to provide.
	// svelte-ignore state_referenced_locally
	setMapContext(map);
	// svelte-ignore state_referenced_locally
	const firstMap = map;
	if (DEV) {
		$effect(() => {
			if (map !== firstMap) {
				console.warn(
					"map-sdk: MapView's `map` prop changed after mount. It is fixed for the component's life (overlays keep the first map); wrap MapView in {#key map} to show another map."
				);
			}
		});
	}

	const dataCredits = createDataCredits(firstMap);
	// The dataset credits go in the engine's attribution control; it is replaced when they change.
	$effect(() => {
		const credits = dataCredits.list;
		if (projector) untrack(() => setDataCredits(projector!, credits));
	});

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
		const engine = controls === "engine";
		const gl = untrack(() => {
			const gl = createGlMap(glContainer, ctx, engine);
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
		// Ready is the first idle after each style load (the first style, and every basemap switch).
		// A wait still pending when the style is replaced or the map detached is dropped, so a stale
		// idle never marks the context ready.
		let stopWaiting: (() => void) | null = null;
		const waitForIdle = () => {
			stopWaiting?.();
			const onIdle = () => {
				stopWaiting?.();
				if (ctx.gl === gl) ctx.markReady();
			};
			stopWaiting = () => {
				gl.off("idle", onIdle);
				stopWaiting = null;
			};
			gl.on("idle", onIdle);
		};
		gl.on("style.load", waitForIdle);
		waitForIdle();
		// Plugins bake theme colors into paint and images, so they set up again on a change.
		const stopTheme = watchTheme(root, () => ctx.themeChanged());
		return () => {
			stopTheme();
			gl.off("style.load", waitForIdle);
			stopWaiting?.();
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
	class={["mapsdk-map mapsdk-focus-outline", className]}
	role="region"
	aria-label={label ?? map.messages("mapsdk_map_label")}
	data-mapsdk-map={map.uid}
>
	<div class="mapsdk-gl" bind:this={glContainer}></div>
	<MapTooltip {map} {project} {width} {height} mode={tooltip} gl={projector} />
	{#if featureList}
		<div class="mapsdk-list-panel">
			<button
				bind:this={listButton}
				type="button"
				class="mapsdk-list-button mapsdk-focus mapsdk-motion text-sm"
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
				<div bind:this={listBox} bind:clientWidth={listWidth} onkeydown={onListKeydown}>
					<FeatureList {map} id={listId} bind:sortBy={listSort} />
				</div>
			{/if}
		</div>
	{/if}
	<!-- After the list, so Tab reaches the List button first. -->
	{#if selectionBar}
		<SelectionBar {map} />
	{/if}
	<ViewSummary {map} />
	{#if controls === "mapsdk"}
		<MapControls {map} gl={projector} />
	{/if}
	{@render overlays?.()}
</div>

<style>
	.mapsdk-map {
		position: relative;
	}

	/* The region takes focus only from script (the selection bar's Clear), never from Tab: the
	   outline alone, from .mapsdk-focus-outline. */
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
		font-family: inherit;
		cursor: pointer;
		pointer-events: auto;
	}

	.mapsdk-list-button:hover {
		background: var(--accent, var(--muted));
	}
</style>
