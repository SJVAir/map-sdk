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
	import {
		cornerSides,
		resolveFeatureList,
		type FeatureListOptions,
		type ListPosition
	} from "./list-placement.js";

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
		/**
		 * The List button and its feature list panel: `false` leaves them out; `true` (default) or
		 * options place them. `position` picks the corner (default `"top-left"`); the button stacks
		 * below (or, in a bottom corner, above) the controls in that corner, and the open panel stops
		 * short of the controls and credits at the far end of its side. `reveal: "focus"` shows the
		 * button only while it or its open panel has keyboard focus (and the whole time the panel is
		 * open); otherwise it's visually hidden but stays in the Tab order, like a skip link.
		 */
		featureList?: boolean | FeatureListOptions;
		/** `false` leaves out the selection bar. */
		selectionBar?: boolean;
		/**
		 * The zoom controls: `"mapsdk"` (default) draws map-sdk's zoom buttons, `"engine"` the
		 * MapTiler SDK's default zoom/compass and locate-me controls, `"none"` none. The credits
		 * always show. Choose it up front: changing it after mount recreates the map (the engine
		 * controls are part of how the map is built), like `active`.
		 */
		controls?: "mapsdk" | "engine" | "none";
		/**
		 * `"pinned"` (default) anchors the tooltip to its feature. `"pointer"` shows it at the
		 * pointer, like sjvair.com's map, and hides it on zoom until the pointer moves again.
		 * Keyboard focus from the feature list always shows it pinned.
		 */
		tooltip?: "pinned" | "pointer";
		/**
		 * `true`: a click or tap on a feature pins its reading card, which takes the pointer and
		 * closes with Esc, its Close button, or a click elsewhere on the map; focusing a
		 * feature-list row shows the same card. Selection and `featureclick` are unchanged.
		 */
		card?: boolean;
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
		tooltip = "pinned",
		card = false
	}: Props = $props();

	// Pinning only, no plugin setup, so it's safe in an effect.
	$effect(() => {
		map.setCardEnabled(card);
		return () => map.setCardEnabled(false);
	});

	/**
	 * Esc outside the card closes it when focus is in this map or nowhere (the body), so a key
	 * pressed in another map, or elsewhere on the page, leaves this card alone.
	 */
	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key !== "Escape" || e.defaultPrevented || !map.pinned) return;
		const active = document.activeElement;
		if (active && active !== document.body && !root.contains(active)) return;
		// Focus nowhere: only the most recently pinned card on the page closes.
		if (!active || active === document.body) {
			let latest: HTMLElement | null = null;
			for (const el of document.querySelectorAll<HTMLElement>("[data-mapsdk-pinned-at]")) {
				if (!latest || Number(el.dataset.mapsdkPinnedAt) > Number(latest.dataset.mapsdkPinnedAt)) {
					latest = el;
				}
			}
			if (latest && latest !== root) return;
		}
		e.preventDefault();
		map.unpin();
	}

	// When this map's card was pinned, so Esc with focus nowhere closes the latest card only.
	$effect(() => {
		const pinned = map.pinned;
		if (!root) return;
		if (pinned) root.dataset.mapsdkPinnedAt = String(performance.now());
		else delete root.dataset.mapsdkPinnedAt;
	});

	const list = $derived(resolveFeatureList(featureList));
	const sides = $derived(list ? cornerSides(list.position) : null);

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
		const panel = box.getBoundingClientRect();
		const mapBox = root.getBoundingClientRect();
		if (sides?.horizontal === "right") map.setListInset(mapBox.right - panel.left, "right");
		else map.setListInset(panel.right - mapBox.left, "left");
	});

	// How far the controls in the button's corner, and in the other corner on its side, reach in
	// from the map's top or bottom edge (px, 0 when there are none), so the button stacks clear of
	// the first and the open panel stops short of the second. Measured, since the engine's
	// controls change size (the credits switch between compact and full; MapTiler's logo).
	let nearExtent = $state(0);
	let farExtent = $state(0);

	function extent(corner: ListPosition): number {
		const mapBox = root.getBoundingClientRect();
		const top = corner.startsWith("top");
		const sources: Element[] = [];
		const engine = glContainer.querySelector(`.maplibregl-ctrl-${corner}`);
		if (engine) sources.push(engine);
		if (corner === "top-right" && controls === "mapsdk") {
			const zoom = root.querySelector(".mapsdk-zoom");
			if (zoom) sources.push(zoom);
		}
		let reach = 0;
		for (const el of sources) {
			const r = el.getBoundingClientRect();
			if (r.height === 0) continue;
			reach = Math.max(reach, top ? r.bottom - mapBox.top : mapBox.bottom - r.top);
		}
		return Math.max(0, reach);
	}

	$effect(() => {
		const s = sides;
		void projector;
		void controls;
		if (!s) return;
		const measure = () => {
			nearExtent = extent(`${s.vertical}-${s.horizontal}`);
			farExtent = extent(s.far);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		const corners = [`${s.vertical}-${s.horizontal}`, s.far].map((c) =>
			glContainer.querySelector(`.maplibregl-ctrl-${c}`)
		);
		for (const el of [...corners, root.querySelector(".mapsdk-zoom")]) {
			if (el) observer.observe(el);
		}
		measure();
		return () => observer.disconnect();
	});

	const inset = (reach: number) => (reach > 0 ? `calc(${reach}px + 0.5rem)` : undefined);

	function onListKeydown(e: KeyboardEvent) {
		if (e.key !== "Escape") return;
		e.preventDefault();
		// The card closes first (and the focused row's card with it); the next Esc closes the panel.
		if (card && (map.pinned || map.focusedKey)) {
			map.unpin();
			map.focusFeature(null);
			return;
		}
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
		// Ready is the first idle after each style load (the first style, and every basemap
		// switch). A wait still pending when the style is replaced or the map detached is dropped,
		// so a stale idle never marks the context ready.
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

<svelte:window onkeydown={onWindowKeydown} />

<div
	bind:this={root}
	bind:clientWidth={width}
	bind:clientHeight={height}
	class={["mapsdk-map mapsdk-focus-outline", className]}
	role="region"
	aria-label={label ?? map.messages("mapsdk_map_label")}
	data-mapsdk-map={map.uid}
	style:--mapsdk-map-width={width > 0 ? `${width}px` : undefined}
>
	<div class="mapsdk-gl" bind:this={glContainer}></div>
	{#if list && sides}
		<div
			class="mapsdk-list-panel"
			data-position={list.position}
			data-reveal={list.reveal}
			data-open={listOpen}
			style:--mapsdk-list-near={inset(nearExtent)}
			style:--mapsdk-list-far={inset(farExtent)}
		>
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
	<!-- After the list, so Tab from a list row reaches the pinned card's Close button. -->
	<MapTooltip {map} {project} {width} {height} mode={tooltip} gl={projector} {card} />
	<!-- After the list, so Tab reaches the List button first. -->
	{#if selectionBar}
		<SelectionBar {map} clearRight={list?.position === "top-right" && controls === "none"} />
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

	/* In its corner: 0.75rem from the edges, or 0.5rem past the controls already there. The open
	   panel also stops 0.5rem short of the controls at the far end of the side. */
	.mapsdk-list-panel {
		position: absolute;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		max-height: calc(100% - var(--mapsdk-list-near, 0.75rem) - var(--mapsdk-list-far, 0.75rem));
		pointer-events: none;
	}

	.mapsdk-list-panel[data-position^="top"] {
		top: var(--mapsdk-list-near, 0.75rem);
	}

	.mapsdk-list-panel[data-position^="bottom"] {
		bottom: var(--mapsdk-list-near, 0.75rem);
		flex-direction: column-reverse;
	}

	.mapsdk-list-panel[data-position$="left"] {
		left: 0.75rem;
	}

	.mapsdk-list-panel[data-position$="right"] {
		right: 0.75rem;
		align-items: flex-end;
	}

	/* reveal: "focus": hidden like a skip link (still in the Tab order and the accessibility tree)
	   until it or its panel has focus, and shown the whole time the panel is open. No transition. */
	.mapsdk-list-panel[data-reveal="focus"][data-open="false"]:not(:focus-within)
		.mapsdk-list-button {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		border: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
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
