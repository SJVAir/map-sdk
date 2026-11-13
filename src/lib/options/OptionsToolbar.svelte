<script lang="ts">
	import type { Snippet } from "svelte";
	import { untrack } from "svelte";
	import { getMapContext } from "../core/context.js";
	import { getMapLayout } from "../view/map-layout.js";
	import Glyph from "./Glyph.svelte";
	import type { MapContext } from "../core/create-map.svelte.js";
	import { OptionsMenus } from "./menus.svelte.js";
	import OptionsMenu from "./OptionsMenu.svelte";
	import { setToolbarContext } from "./toolbar-context.js";
	import type { OptionGroup, OptionValues } from "./types.js";
	import type { OptionChange } from "./values.js";

	interface Props {
		/** The groups to show, in order; pass a new array to change them (open menus stay open). */
		groups: OptionGroup[];
		/** The host's values. Setting them never calls `onchange`. */
		values: OptionValues;
		/** Called once per user action with the whole new values object and the keys it changed. */
		onchange: (values: OptionValues, changed: string[]) => void;
		/** What `reset` rows put back; without it, they're not shown. */
		defaults?: OptionValues;
		/** Shows the values without letting them change: rows stay focusable (`aria-disabled`). */
		readonly?: boolean;
		/** Last on the wide toolbar; beside the options button on the narrow one. */
		search?: Snippet;
		/**
		 * The key of the basemap rows (`basemapOptions(map).key`): they show `map.basemap.current`,
		 * what the map draws, rather than `values[key]`. A fallback never calls `onchange`.
		 */
		basemapKey?: string;
		/** Defaults to the map of the enclosing `MapView`. */
		map?: MapContext;
	}

	let {
		groups,
		values,
		onchange,
		defaults,
		readonly = false,
		search,
		basemapKey,
		map: mapProp
	}: Props = $props();

	// svelte-ignore state_referenced_locally
	const map = mapProp ?? getMapContext();
	const uid = $props.id();
	const menus = new OptionsMenus();
	const layout = getMapLayout();
	// Outside a MapView there's no map box to measure: the wide row.
	const wide = $derived(layout ? layout.wide : true);
	const panelId = `${uid}-panel`;
	let panelOpen = $state(false);
	let openButton: HTMLButtonElement | undefined = $state();
	let closeButton: HTMLButtonElement | undefined = $state();

	// Open menus mean different things in the two layouts (dropdowns, sections), so crossing the
	// breakpoint starts from everything closed.
	let lastWide = untrack(() => wide);
	$effect(() => {
		if (wide === lastWide) return;
		lastWide = wide;
		untrack(() => {
			menus.closeAll();
			panelOpen = false;
		});
	});

	// A group removed or disabled while open is forgotten (an id left behind would swallow Esc,
	// and reopen the group when it comes back).
	$effect(() => {
		const ids = new Set(groups.filter((g) => !g.disabled).map((g) => g.id));
		untrack(() => menus.keepOnly(ids));
	});

	// A dropdown a mouse is showing closes on Esc wherever focus is (WCAG 1.4.13). Only this
	// toolbar's: the pointer is over one toolbar at a time.
	$effect(() => {
		const hovered = menus.hovered;
		if (hovered === null) return;
		const onkeydown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) menus.unhover(hovered);
		};
		document.addEventListener("keydown", onkeydown);
		return () => document.removeEventListener("keydown", onkeydown);
	});

	// The panel covers the map: the map's other pieces go inert while it's open.
	$effect(() => {
		const covered = !wide && panelOpen;
		layout?.setCovered(covered);
		return () => layout?.setCovered(false);
	});

	/** Tells MapView which element is the bar, so it measures the one on screen. */
	const registerBar = (bar: HTMLElement) => {
		layout?.setBar(bar);
		return () => layout?.setBar(null);
	};

	/** Clusters keyed by their cluster name (or first group), so a group added earlier in the list doesn't remount the open one. */
	function clusterKey(cluster: OptionGroup[], i: number): string {
		const name = cluster[0].cluster;
		if (name === undefined) return `group:${cluster[0].id}`;
		const before = clusters.slice(0, i).filter((c) => c[0].cluster === name).length;
		return `cluster:${name}:${before}`;
	}

	function openPanel() {
		panelOpen = true;
		// Into the panel, for keyboard and screen-reader users.
		queueMicrotask(() => closeButton?.focus());
	}

	function closePanel() {
		panelOpen = false;
		openButton?.focus();
	}

	setToolbarContext({
		map,
		menus,
		uid,
		get values() {
			return values;
		},
		get defaults() {
			return defaults;
		},
		get readonly() {
			return readonly;
		},
		get wide() {
			return wide;
		},
		valueOf(id: string) {
			return basemapKey !== undefined && id === basemapKey ? map.basemap.current : values[id];
		},
		emit(change: OptionChange) {
			if (readonly || change.changed.length === 0) return;
			onchange(change.values, change.changed);
		}
	});

	/** Consecutive groups with the same `cluster` join into one button row. */
	const clusters = $derived.by(() => {
		const out: OptionGroup[][] = [];
		for (const group of groups) {
			const last = out.at(-1);
			if (last && group.cluster !== undefined && last[0].cluster === group.cluster)
				last.push(group);
			else out.push([group]);
		}
		return out;
	});

	let root: HTMLDivElement;

	// A click outside this toolbar closes its dropdowns; clicks inside never do.
	$effect(() => {
		const onclick = (e: MouseEvent) => {
			// The path, not the target: a click that re-rendered its own row leaves a detached target.
			if (wide && !e.composedPath().includes(root)) menus.closeAll();
		};
		document.addEventListener("click", onclick);
		return () => document.removeEventListener("click", onclick);
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== "Escape") return;
		if (!wide) {
			if (!panelOpen) return;
			e.preventDefault();
			e.stopPropagation();
			closePanel();
			return;
		}
		// Nothing open: Esc is the map's (a pinned card, the list).
		if (!menus.anyOpen) return;
		const menu = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
			"[data-options-menu]"
		);
		menus.closeAll();
		// Esc is this toolbar's: the map's card and list don't also take it.
		e.preventDefault();
		e.stopPropagation();
		const trigger = menu?.querySelector<HTMLElement>(":scope > button");
		if (trigger && trigger !== document.activeElement) trigger.focus();
	}
</script>

<!-- Esc anywhere in the toolbar closes its dropdowns or panel. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={root}
	class="mapsdk-options"
	data-layout={wide ? "wide" : "narrow"}
	role="group"
	aria-label={map.messages("mapsdk_options_toolbar_label")}
	{onkeydown}
>
	{#if wide}
		<div class="mapsdk-options-bar" data-mapsdk-toolbar-bar {@attach registerBar}>
			{#each clusters as cluster, i (clusterKey(cluster, i))}
				<div class="mapsdk-options-cluster">
					{#each cluster as group (group.id)}
						<OptionsMenu {group} />
					{/each}
				</div>
			{/each}
			{#if search}
				<div class="mapsdk-options-search">{@render search()}</div>
			{/if}
		</div>
	{:else}
		<div class="mapsdk-options-bar" data-mapsdk-toolbar-bar {@attach registerBar}>
			<button
				bind:this={openButton}
				type="button"
				class="mapsdk-options-open mapsdk-focus mapsdk-motion"
				aria-label={map.messages("mapsdk_options_open")}
				aria-expanded={panelOpen}
				aria-controls={panelId}
				onclick={openPanel}
			>
				<Glyph name="slidersHorizontal" size={22} />
			</button>
			{#if search}
				<div class="mapsdk-options-search">{@render search()}</div>
			{/if}
		</div>
		<div
			id={panelId}
			class="mapsdk-options-panel"
			data-open={panelOpen}
			role="region"
			aria-labelledby="{panelId}-title"
		>
			<div class="mapsdk-options-panel-header">
				<p id="{panelId}-title" class="text-lg">{map.messages("mapsdk_options_title")}</p>
				<button
					bind:this={closeButton}
					type="button"
					class="mapsdk-options-close mapsdk-focus mapsdk-motion"
					aria-label={map.messages("mapsdk_options_close")}
					onclick={closePanel}
				>
					<Glyph name="x" size={20} />
				</button>
			</div>
			{#each groups as group (group.id)}
				<OptionsMenu {group} />
			{/each}
		</div>
	{/if}
</div>

<style>
	.mapsdk-options {
		color: var(--foreground);
	}

	/* The bar lets the pointer through between its buttons (it spans the map's top in MapView). */
	.mapsdk-options-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5rem;
		pointer-events: none;
	}

	.mapsdk-options-bar > :global(*) {
		pointer-events: auto;
	}

	.mapsdk-options-open,
	.mapsdk-options-close {
		display: flex;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-card, none);
		cursor: pointer;
	}

	.mapsdk-options-close {
		width: 2.25rem;
		height: 2.25rem;
		border-color: transparent;
		box-shadow: none;
	}

	.mapsdk-options-open:hover,
	.mapsdk-options-close:hover {
		background: var(--accent, var(--muted));
	}

	/* Narrow: a panel over the whole map (its containing block is MapView's toolbar slot). */
	.mapsdk-options-panel {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 1rem;
		overflow-y: auto;
		background: var(--background);
		color: var(--foreground);
		pointer-events: auto;
	}

	.mapsdk-options-panel[data-open="false"] {
		visibility: hidden;
		translate: -100% 0;
	}

	@media (prefers-reduced-motion: no-preference) {
		.mapsdk-options-panel {
			transition-property: translate, visibility;
			transition-duration: 200ms;
		}
	}

	.mapsdk-options-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.mapsdk-options-panel-header p {
		margin: 0;
		font-weight: 600;
	}

	/* Narrow: each group is a section that expands in place. */
	.mapsdk-options-panel :global(.mapsdk-options-trigger) {
		border: 1px solid var(--border);
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
	}

	.mapsdk-options-panel :global(.mapsdk-options-dropdown) {
		position: static;
		min-width: 0;
	}

	.mapsdk-options-panel :global(.mapsdk-options-dropdown-body) {
		max-height: none;
		overflow: visible;
		border: 0;
		box-shadow: none;
	}

	.mapsdk-options-cluster {
		display: flex;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		box-shadow: var(--shadow-card, none);
	}

	.mapsdk-options-cluster > :global(.mapsdk-options-menu + .mapsdk-options-menu) {
		border-left: 1px solid var(--border);
	}

	.mapsdk-options-cluster > :global(.mapsdk-options-menu:first-child > button) {
		border-top-left-radius: var(--radius-control, var(--radius));
		border-bottom-left-radius: var(--radius-control, var(--radius));
	}

	.mapsdk-options-cluster > :global(.mapsdk-options-menu:last-child > button) {
		border-top-right-radius: var(--radius-control, var(--radius));
		border-bottom-right-radius: var(--radius-control, var(--radius));
	}
</style>
