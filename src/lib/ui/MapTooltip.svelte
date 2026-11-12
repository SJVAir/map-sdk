<script lang="ts">
	import { untrack } from "svelte";
	import type { Attachment } from "svelte/attachments";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { GlMapLike } from "../core/gl.js";
	import type { FeatureListItem, MapPlugin } from "../core/plugin.js";
	import TooltipItem from "./TooltipItem.svelte";
	import type { Snippet } from "svelte";
	import type { CardContext } from "./card.js";
	import { selectionKeys } from "../data/selection.js";

	interface Props {
		map: MapContext;
		/**
		 * Canvas pixel for a position, or `null` while there is no GL map. Reactive: it should
		 * read something that changes when the camera moves, so the tooltip follows the map.
		 */
		project: (lngLat: [number, number]) => { x: number; y: number } | null;
		/** The map container's size; the tooltip stays inside it. Unset: no clamping. */
		width?: number;
		height?: number;
		/**
		 * `"pinned"` (default) anchors the tooltip to its feature; `"pointer"` shows it at the last
		 * pointer position and hides it on `gl`'s `zoomstart` until the next pointer move over a
		 * hit.
		 * A keyboard-focused list item is always pinned.
		 */
		mode?: "pinned" | "pointer";
		/** The GL map, for `zoomstart` in `"pointer"` mode. */
		gl?: Pick<GlMapLike, "on" | "off"> | null;
		/**
		 * The pinned reading card: `map.pinned` and a focused list item show as an interactive card
		 * (pointer events, a Close button, Esc), and the hover doesn't show while one is pinned.
		 */
		card?: boolean;
		/** The host's buttons on the card (`MapView`'s `card.actions`). */
		actions?: Snippet<[CardContext]>;
	}

	let {
		map,
		project,
		width,
		height,
		mode = "pinned",
		gl = null,
		card = false,
		actions
	}: Props = $props();

	// Ignored without the card, so a host's map never pins.
	const pinned = $derived(card ? map.pinned : null);

	// Pointer mode only: set by a zoom, cleared by the next pointer move over a hit.
	let zoomHidden = $state(false);
	$effect(() => {
		// Captured: props are live, and the cleanup runs after MapView has set `gl` to null.
		const g = gl;
		if (mode !== "pointer" || !g) return;
		const onZoomStart = () => (zoomHidden = true);
		g.on("zoomstart", onZoomStart);
		return () => g.off("zoomstart", onZoomStart);
	});
	$effect(() => {
		// A new hovered object comes with every pointer move over a hit.
		if (map.hovered) zoomHidden = false;
	});

	let tipWidth = $state(0);
	let tipHeight = $state(0);
	const GAP = 12;

	// The keyboard-focused list item wins, then the pinned card, then the pointer (which shows
	// nothing while a card is pinned).
	const shownHit = $derived(map.focusedKey ? null : (pinned ?? map.hovered));
	const key = $derived(map.focusedKey ?? shownHit?.hit.refKey ?? null);
	// Primitives, so moving the pointer within one feature doesn't recompute the content.
	const hitPluginId = $derived(shownHit?.hit.pluginId ?? null);
	const hitName = $derived(shownHit?.hit.name ?? null);
	// The card shows (interactive) for a focused item or a pinned feature.
	const interactive = $derived(card && (map.focusedKey !== null || pinned !== null));

	// Reads only the shown feature's plugin (or all plugins for a focused key), and only while
	// something is shown, so an idle map doesn't subscribe to any plugin's data.
	const found = $derived.by((): { item: FeatureListItem; plugin: MapPlugin } | null => {
		if (key === null) return null;
		// The hovered hit's plugin, or the focused one; without either, the first plugin listing the key.
		const pluginId = hitPluginId ?? map.focusedPluginId;
		const plugins = pluginId ? map.plugins.filter((p) => p.id === pluginId) : map.plugins;
		for (const plugin of plugins) {
			const item = plugin.features?.().find((f) => f.refKey === key);
			if (item) return { item, plugin };
		}
		return null;
	});

	const item = $derived(found?.item ?? null);
	const name = $derived(item?.name ?? hitName);
	// A found item anchors the tooltip at its point (stable while the pointer moves over it).
	// In pointer mode a hovered hit is anchored at the pointer instead (a focused item stays
	// pinned).
	// A hovered shape whose point is off-screen pins at a point of it in view, found once per
	// hovered feature (keyed on primitives), so pointer moves within it don't move the tooltip.
	// It's found again when the map settles (`bounds`), so a pan or zoom under a resting pointer
	// doesn't leave it off-screen.
	const hoverKey = $derived(
		!map.focusedKey && item && hitPluginId ? `${hitPluginId}\n${item.refKey}` : null
	);
	const hoverAnchor = $derived.by(() => {
		if (hoverKey === null) return null;
		void map.bounds;
		return untrack(() => (item?.geometry ? map.anchorFor(item) : null));
	});
	const anchor = $derived.by((): [number, number] | null => {
		if (mode === "pointer" && !map.focusedKey && !pinned) return map.hovered?.lngLat ?? null;
		// A focused feature that left the data has no item, so no tooltip.
		if (map.focusedKey) return item ? (map.focusedAnchor ?? item.lngLat) : null;
		return hoverAnchor ?? item?.lngLat ?? shownHit?.lngLat ?? null;
	});
	const projected = $derived(anchor ? project(anchor) : null);
	// A card whose anchor is out of the map's box hides until it's back.
	const offScreen = $derived(
		interactive &&
			projected !== null &&
			width !== undefined &&
			height !== undefined &&
			(projected.x < 0 || projected.y < 0 || projected.x > width || projected.y > height)
	);
	// Centered above the point; flipped below it near the top edge; inside the container.
	const position = $derived.by(() => {
		if (!projected) return null;
		let { x, y } = projected;
		if (width)
			x = Math.min(Math.max(x, tipWidth / 2), Math.max(width - tipWidth / 2, tipWidth / 2));
		let top = y - tipHeight - GAP;
		if (top < 0) top = y + GAP;
		if (height) top = Math.min(top, Math.max(height - tipHeight, 0));
		return { left: x - tipWidth / 2, top: Math.max(top, 0) };
	});
	const custom = $derived.by(() => {
		if (found) return found.plugin.tooltip?.(found.item);
		// A hovered hit no plugin lists (e.g. a cluster bubble): its plugin's hover content.
		if (key === null || hitPluginId === null) return undefined;
		const plugin = map.plugins.find((p) => p.id === hitPluginId);
		const hit = untrack(() => shownHit?.hit);
		return hit && plugin?.hoverTooltip?.(hit);
	});

	// The name header is left out when the plugin's own tooltip content shows the name.
	const showName = $derived.by(() => {
		if (!name) return false;
		if (!custom) return true;
		const plugin = found?.plugin ?? map.plugins.find((p) => p.id === hitPluginId);
		return !plugin?.tooltipShowsName;
	});

	// The card's feature for the host's actions: the focused item, or the pinned hit.
	const cardContext = $derived.by((): CardContext | null => {
		if (!interactive || !actions) return null;
		const pluginId = found?.plugin.id ?? hitPluginId;
		const ref = item?.ref ?? shownHit?.hit.ref;
		const refKey = key;
		if (!pluginId || !ref || refKey === null) return null;
		return {
			pluginId,
			ref,
			refKey,
			item,
			get selected() {
				return selectionKeys(map.getSelection(pluginId)).has(refKey);
			},
			toggle: () => map.togglePick(pluginId, ref)
		};
	});

	let cardEl: HTMLDivElement | undefined = $state();
	/** Where focus came from when it moved into the card, to return it on close. */
	let origin: HTMLElement | null = null;

	function onfocusin(e: FocusEvent) {
		const from = e.relatedTarget;
		focusInside = true;
		region = cardEl?.closest<HTMLElement>("[data-mapsdk-map]") ?? region;
		// Focus from outside sets the origin afresh, even from nowhere, so an earlier card's
		// origin is never reused.
		if (!(from instanceof Node && cardEl?.contains(from))) {
			origin = from instanceof HTMLElement ? from : null;
		}
	}

	/** Focus is inside the card (kept by focusin/focusout, since a removed card no longer says). */
	let focusInside = false;
	/** The map region the card is in, found while it's in the document. */
	let region: HTMLElement | null = null;

	function onfocusout(e: FocusEvent) {
		const to = e.relatedTarget;
		if (to instanceof Node && cardEl?.contains(to)) return;
		// Later, not now: removing the focused card fires focusout too, and its teardown (which
		// runs first) still has to see that focus was inside.
		queueMicrotask(() => {
			if (!cardEl?.contains(document.activeElement)) focusInside = false;
		});
	}

	/** Focus inside the card goes back where it came from, else to the map region. */
	function handBack() {
		if (!focusInside) return;
		focusInside = false;
		const back = origin;
		origin = null;
		if (back?.isConnected) back.focus();
		else if (region?.isConnected) {
			if (!region.hasAttribute("tabindex")) region.setAttribute("tabindex", "-1");
			region.focus();
		}
	}

	// However the card goes (Close, a host's unpin, its plugin removed, its anchor off-screen),
	// focus inside it isn't left on a removed node.
	const handBackOnRemove: Attachment<HTMLElement> = () => () => handBack();

	/** Unpins, handing focus back first. */
	function close() {
		handBack();
		map.unpin();
		// Focus back on a list row focuses (and so shows) that row again; the card stays closed
		// until the next row move, as with Esc in the list.
		if (map.focusedKey !== null) map.focusFeature(null);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== "Escape") return;
		e.preventDefault();
		e.stopPropagation();
		close();
	}

	// A pinned hit with nothing to show (no name, listed item, or hover content) would be an
	// invisible card that still hides the hover and takes Esc: unpin it.
	$effect(() => {
		if (pinned && !map.focusedKey && !(name || item || custom)) untrack(() => map.unpin());
	});

	// A pinned feature that left its plugin's data (a poll dropped it) closes its card. Only one
	// its plugin listed while pinned: some hits are never listed (HMS fire hotspots), and keep it.
	let listedKey: string | null = null;
	$effect(() => {
		if (!pinned || map.focusedKey) return;
		const { pluginId, refKey } = pinned.hit;
		const plugin = map.plugins.find((p) => p.id === pluginId);
		if (!plugin?.features) return;
		const id = `${pluginId}\n${refKey}`;
		if (plugin.features().some((f) => f.refKey === refKey)) listedKey = id;
		else if (listedKey === id) {
			listedKey = null;
			untrack(close);
		}
	});
</script>

<!-- Only with something to show: a hit with no name, item, or content gets no empty box. -->
{#if interactive && (name || item || custom) && position && !offScreen}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={cardEl}
		{@attach handBackOnRemove}
		class="mapsdk-tooltip mapsdk-card text-sm"
		role="group"
		aria-label={name ?? undefined}
		bind:offsetWidth={tipWidth}
		bind:offsetHeight={tipHeight}
		style:left="{position.left}px"
		style:top="{position.top}px"
		{onfocusin}
		{onfocusout}
		{onkeydown}
	>
		{#if showName}
			<div class="mapsdk-tooltip-name">{name}</div>
		{/if}
		{#if custom}
			{@render custom()}
		{:else if item}
			<TooltipItem {item} messages={map.messages} format={map.format} />
		{/if}
		{#if actions && cardContext}
			<div class="mapsdk-card-actions">{@render actions(cardContext)}</div>
		{/if}
		<button
			type="button"
			class="mapsdk-card-close mapsdk-focus"
			aria-label={map.messages("mapsdk_card_close")}
			onclick={close}
		>
			<span aria-hidden="true">×</span>
		</button>
	</div>
{:else if !interactive && (name || item || custom) && position && !(zoomHidden && !map.focusedKey)}
	<div
		class="mapsdk-tooltip text-sm"
		role="tooltip"
		bind:offsetWidth={tipWidth}
		bind:offsetHeight={tipHeight}
		style:left="{position.left}px"
		style:top="{position.top}px"
	>
		{#if showName}
			<div class="mapsdk-tooltip-name">{name}</div>
		{/if}
		{#if custom}
			{@render custom()}
		{:else if item}
			<TooltipItem {item} messages={map.messages} format={map.format} />
		{/if}
	</div>
{/if}

<style>
	.mapsdk-tooltip {
		position: absolute;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		max-width: 16rem;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--popover, var(--background));
		color: var(--popover-foreground, var(--foreground));
		box-shadow: var(--shadow-lifted, var(--shadow-card, none));
		pointer-events: none;
	}

	/* The monitor, cluster, and collocation tooltips (today's ~420px cards) mark their content
	   `mapsdk-tooltip-wide`: wide enough for a reading box and name, never wider than the map. */
	.mapsdk-tooltip:has(:global(.mapsdk-tooltip-wide)) {
		width: max-content;
		max-width: min(28rem, calc(100% - 1rem));
	}

	.mapsdk-tooltip-name {
		font-weight: 600;
	}

	/* The pinned card: takes the pointer, and sits above the feature list panel. Room on the
	   right for the Close button. */
	.mapsdk-card {
		z-index: 3;
		padding-right: 2rem;
		pointer-events: auto;
	}

	.mapsdk-card-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.mapsdk-card-close {
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-control, var(--radius));
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 1.125rem;
		line-height: 1;
		cursor: pointer;
	}

	.mapsdk-card-close:hover {
		background: var(--accent, var(--muted));
	}
</style>
