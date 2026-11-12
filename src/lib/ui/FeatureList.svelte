<script lang="ts">
	import { onDestroy, tick, untrack } from "svelte";
	import type { Bounds, MapContext } from "../core/create-map.svelte.js";
	import type { FeatureListItem } from "../core/plugin.js";
	import { selectionKeys } from "../data/selection.js";
	import "./controls.css";
	import {
		MENU_EVENT_WINDOW_MS,
		inView,
		optionIdPart,
		rowLabel,
		levelText,
		shownLevel,
		shownValue,
		sortItems,
		typeaheadIndex,
		type SortBy
	} from "./feature-list.js";

	interface Props {
		map: MapContext;
		class?: string;
		/** The root element's id, e.g. for a button's `aria-controls`. */
		id?: string;
		/** The sort order; bind it to keep it while the list is unmounted. */
		sortBy?: SortBy;
	}

	let { map, class: className, id, sortBy = $bindable("name") }: Props = $props();

	const baseId = $props.id();
	/** Rows rendered above and below the visible ones. */
	const OVERSCAN = 10;
	const TYPEAHEAD_MS = 500;

	type Row = FeatureListItem & { pluginId: string; key: string };

	let listbox: HTMLElement | undefined = $state();
	let scroller: HTMLElement | undefined = $state();
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	// Measured from a hidden row, so the row height stays in CSS (rem-based).
	let rowHeight = $state(0);
	let activeKey = $state<string | null>(null);

	let typeahead = "";
	let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
	// Shift+F10 or the Menu key already sent a menu event to the active row, so the browser's own
	// event (on keydown or keyup, depending on the platform) is dropped.
	let menuSent = false;
	let menuSentTimer: ReturnType<typeof setTimeout> | undefined;
	// Focus from a pointer: the click picks the row, so focusing doesn't activate the first one.
	let pointerFocus = false;
	// While the listbox has focus it filters by the bounds from when focus arrived: each key press
	// pans the map, and re-filtering on that pan's moveend would reshuffle the rows under the user.
	let frozen = $state.raw<{ bounds: Bounds | null } | null>(null);

	// Every plugin's features in view, re-computed when the view settles (bounds change on
	// moveend; not while focused, see `frozen`) or a plugin's data changes. A refKey a plugin
	// repeats is listed once, its first item.
	const rows = $derived.by((): Row[] => {
		const bounds = frozen ? frozen.bounds : map.bounds;
		const all = map.plugins.flatMap((plugin) => {
			const items = plugin.features?.() ?? [];
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to one computation
			const seen = new Set<string>();
			return (bounds ? inView(items, bounds) : items).flatMap((item) => {
				if (seen.has(item.refKey)) return [];
				seen.add(item.refKey);
				return [{ ...item, pluginId: plugin.id, key: optionIdPart(plugin.id, item.refKey) }];
			});
		});
		return sortItems(all, sortBy) as Row[];
	});

	const selected = $derived(
		new Map(map.plugins.map((p) => [p.id, selectionKeys(map.getSelection(p.id))]))
	);
	const multiselectable = $derived(
		map.plugins.some((p) => map.getSelectionMode(p.id) === "multiple")
	);

	const activeIndex = $derived(
		activeKey === null ? -1 : rows.findIndex((r) => r.key === activeKey)
	);

	// The visible rows plus OVERSCAN either side; always including the active row, so
	// `aria-activedescendant` points at an element in the DOM.
	const range = $derived.by(() => {
		const h = rowHeight || 1;
		let start = Math.max(0, Math.floor(scrollTop / h) - OVERSCAN);
		let end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / h) + OVERSCAN);
		if (activeIndex >= 0) {
			start = Math.min(start, activeIndex);
			end = Math.max(end, activeIndex + 1);
		}
		return { start, end };
	});
	const windowRows = $derived(rows.slice(range.start, range.end));

	// Whatever moved the active row (keys, a data change, a re-filter), keep it in view.
	$effect(() => {
		const index = activeIndex;
		const h = rowHeight;
		const el = scroller;
		if (index < 0 || !h || !el) return;
		untrack(() => {
			const top = index * h;
			if (top < el.scrollTop) el.scrollTop = top;
			else if (top + h > el.scrollTop + el.clientHeight) el.scrollTop = top + h - el.clientHeight;
			scrollTop = el.scrollTop;
		});
	});

	/** Stable per row, so a row keeps its id when the list re-sorts or re-filters. */
	function optionId(row: Row): string {
		return `${baseId}-${row.key}`;
	}

	function setSort(by: SortBy) {
		sortBy = by;
		if (frozen) frozen = { bounds: map.bounds };
	}

	function isSelectable(row: Row): boolean {
		return row.selectable && map.getSelectionMode(row.pluginId) !== "none";
	}

	function isSelected(row: Row): boolean {
		return selected.get(row.pluginId)?.has(row.refKey) ?? false;
	}

	/** Makes row `index` active and focuses (and pans to) its feature. */
	function activate(index: number) {
		const row = rows[index];
		if (!row) return;
		activeKey = row.key;
		map.focusFeature(row.refKey, row.pluginId);
	}

	function pick(row: Row, additive: boolean) {
		map.pickFromList(row.pluginId, row.refKey, additive);
	}

	function pageSize(): number {
		return Math.max(1, Math.floor(viewportHeight / (rowHeight || 1)) - 1);
	}

	async function openMenu() {
		const row = rows[activeIndex];
		if (!row) return;
		await tick();
		const el = document.getElementById(optionId(row));
		if (!el) return;
		const box = el.getBoundingClientRect();
		el.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				composed: true,
				button: 2,
				clientX: box.left + Math.min(box.width / 2, 24),
				clientY: box.top + box.height / 2
			})
		);
	}

	function onkeydown(e: KeyboardEvent) {
		const last = rows.length - 1;
		if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
			e.preventDefault();
			if (activeIndex < 0) return;
			menuSent = true;
			clearTimeout(menuSentTimer);
			menuSentTimer = setTimeout(() => (menuSent = false), MENU_EVENT_WINDOW_MS);
			void openMenu();
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const current = activeIndex;
		let next: number;
		switch (e.key) {
			case "ArrowDown":
				next = Math.min(current + 1, last);
				break;
			case "ArrowUp":
				next = current < 0 ? 0 : Math.max(current - 1, 0);
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = last;
				break;
			case "PageDown":
				next = Math.min(Math.max(current, 0) + pageSize(), last);
				break;
			case "PageUp":
				next = Math.max(current - pageSize(), 0);
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				// Space, or Shift with Enter, is the additive key (as Shift-click on a row).
				if (current >= 0) pick(rows[current], e.key === " " || e.shiftKey);
				return;
			default:
				if (e.key.length === 1 && e.key !== " ") {
					e.preventDefault();
					findByTyping(e.key);
				}
				return;
		}
		e.preventDefault();
		if (rows.length > 0) activate(next);
	}

	function findByTyping(char: string) {
		clearTimeout(typeaheadTimer);
		typeaheadTimer = setTimeout(() => (typeahead = ""), TYPEAHEAD_MS);
		// A new search starts after the active row; a longer one may stay on it.
		const from = typeahead === "" ? activeIndex + 1 : Math.max(activeIndex, 0);
		typeahead += char;
		const index = typeaheadIndex(rows, typeahead, from);
		if (index >= 0) activate(index);
	}

	function onfocus() {
		frozen = { bounds: map.bounds };
		const byPointer = pointerFocus;
		pointerFocus = false;
		if (byPointer || rows.length === 0) return;
		if (activeIndex >= 0) {
			const row = rows[activeIndex];
			map.focusFeature(row.refKey, row.pluginId);
		} else {
			const first = rows.findIndex(isSelected);
			activate(first >= 0 ? first : 0);
		}
	}

	/** Clears the map's focus if it still points at the active row. */
	function releaseFocus() {
		const row = rows[activeIndex];
		if (row && map.focusedKey === row.refKey && map.focusedPluginId === row.pluginId) {
			map.focusFeature(null);
		}
	}

	function onblur() {
		pointerFocus = false;
		releaseFocus();
		frozen = null;
	}

	function oncontextmenu(e: MouseEvent) {
		// A row's own event (a right-click) bubbles as is. The browser's keyboard menu event
		// targets the focused listbox instead, so it goes to the active row.
		if (e.target !== listbox || activeIndex < 0) return;
		e.preventDefault();
		e.stopPropagation();
		if (menuSent) menuSent = false;
		else void openMenu();
	}

	function onrowclick(e: MouseEvent, index: number) {
		activate(index);
		pick(rows[index], e.shiftKey || e.metaKey || e.ctrlKey);
	}

	onDestroy(() => {
		clearTimeout(typeaheadTimer);
		clearTimeout(menuSentTimer);
		// Unmounting a focused listbox may not fire blur.
		untrack(releaseFocus);
	});
</script>

<div class={["mapsdk-list text-sm", className]} {id} data-mapsdk-map={map.uid}>
	<div class="mapsdk-list-sort">
		<button
			type="button"
			class="mapsdk-focus mapsdk-motion"
			aria-pressed={sortBy === "name"}
			onclick={() => setSort("name")}
		>
			{map.messages("mapsdk_list_sort_name")}
		</button>
		<button
			type="button"
			class="mapsdk-focus mapsdk-motion"
			aria-pressed={sortBy === "value"}
			onclick={() => setSort("value")}
		>
			{map.messages("mapsdk_list_sort_value")}
		</button>
	</div>
	<div class="mapsdk-list-row mapsdk-list-sizer" aria-hidden="true" bind:offsetHeight={rowHeight}>
		&nbsp;
	</div>
	<!-- The scroller is separate from the listbox: the listbox's padding stands in for the rows
	     that aren't rendered, and a scroll container can't shrink its own padding. -->
	<div
		bind:this={scroller}
		bind:clientHeight={viewportHeight}
		class="mapsdk-list-scroll"
		onscroll={() => (scrollTop = scroller!.scrollTop)}
	>
		<div
			bind:this={listbox}
			class="mapsdk-list-box mapsdk-focus-inset-active"
			role="listbox"
			tabindex="0"
			aria-label={map.messages("mapsdk_list_label")}
			aria-multiselectable={multiselectable || undefined}
			aria-activedescendant={activeIndex >= 0 ? optionId(rows[activeIndex]) : undefined}
			style:padding-top="{range.start * rowHeight}px"
			style:padding-bottom="{(rows.length - range.end) * rowHeight}px"
			{onkeydown}
			{onfocus}
			{onblur}
			{oncontextmenu}
			onpointerdown={() => (pointerFocus = true)}
		>
			{#each windowRows as row, i (row.key)}
				{@const index = range.start + i}
				{@const level = shownLevel(row)}
				{@const levelPlace = levelText(row, map.messages)}
				{@const value = shownValue(row, map.format)}
				{@const isOn = isSelected(row)}
				<!-- Options aren't focused: the listbox holds focus and handles keys (aria-activedescendant). -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
				<div
					id={optionId(row)}
					class="mapsdk-list-row"
					class:mapsdk-active-option={index === activeIndex}
					class:active={index === activeIndex}
					class:selected={isOn}
					role="option"
					aria-selected={isSelectable(row) ? isOn : undefined}
					aria-setsize={rows.length}
					aria-posinset={index + 1}
					aria-label={rowLabel(row, map.messages, map.format)}
					data-mapsdk-ref={row.refKey}
					data-mapsdk-plugin={row.pluginId}
					onclick={(e) => onrowclick(e, index)}
				>
					<span class="mapsdk-list-check" aria-hidden="true">
						{#if isOn}
							<svg viewBox="0 0 16 16" width="14" height="14">
								<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" />
							</svg>
						{/if}
					</span>
					<span class="mapsdk-list-name">{row.name}</span>
					<span class="mapsdk-list-value">
						{value ?? ""}{#if row.units && value !== null}&nbsp;{row.units}{/if}
					</span>
					<span class="mapsdk-list-level text-xs">
						{#if levelPlace.kind === "level" || levelPlace.kind === "none"}
							<span
								class="mapsdk-list-swatch"
								class:neutral={!level?.color}
								style:background={level?.color || undefined}
							></span>
						{/if}
						{levelPlace.text}
					</span>
				</div>
			{/each}
		</div>
	</div>
	{#if rows.length === 0}
		<p class="mapsdk-list-empty">{map.messages("mapsdk_list_empty")}</p>
	{/if}
</div>

<style>
	.mapsdk-list {
		--mapsdk-list-row-height: 2.25rem;
		display: flex;
		flex-direction: column;
		position: relative;
		width: 21rem;
		/* The map's width inside a MapView (set there), else the window's. */
		max-width: calc(var(--mapsdk-map-width, 100vw) - 2rem);
		max-height: 100%;
		box-sizing: border-box;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-lifted, var(--shadow-card, none));
		pointer-events: auto;
	}

	.mapsdk-list-sort {
		display: flex;
		gap: 0.25rem;
		padding: 0.5rem;
		border-bottom: 1px solid var(--card-border, var(--border));
	}

	.mapsdk-list-sort button {
		padding: 0.25rem 0.625rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		font: inherit;
		cursor: pointer;
	}

	.mapsdk-list-sort button[aria-pressed="true"] {
		background: var(--highlight-subtle, var(--muted));
		border-color: var(--highlight, var(--primary));
	}

	.mapsdk-list-scroll {
		flex: 1 1 auto;
		min-height: 0;
		max-height: calc(var(--mapsdk-list-row-height) * 10);
		overflow-y: auto;
	}

	.mapsdk-list-box {
		outline: none;
	}

	/* With no active row to carry the ring (an empty list), the scroller shows it. */
	.mapsdk-list-scroll:has(.mapsdk-list-box:focus-visible):not(:has(.active)) {
		outline: 2px solid var(--ring);
		outline-offset: -3px;
		box-shadow: inset 0 0 0 4px var(--ring-edge, var(--background));
	}

	.mapsdk-list-row {
		display: grid;
		grid-template-columns: 1rem minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.5rem;
		height: var(--mapsdk-list-row-height);
		box-sizing: border-box;
		padding: 0 0.75rem;
		cursor: default;
		white-space: nowrap;
	}

	.mapsdk-list-sizer {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
	}

	.mapsdk-list-row.selected {
		background: var(--highlight-subtle, var(--muted));
		box-shadow: inset 0 0 0 2px var(--highlight, var(--primary));
	}

	/* Selected and active: the selection ring outside the focus halo; more specific than the
	   shared rule, so the order of the stylesheets doesn't matter. */
	.mapsdk-list-box:focus-visible .mapsdk-list-row.selected.mapsdk-active-option {
		box-shadow:
			inset 0 0 0 4px var(--ring-edge, var(--background)),
			inset 0 0 0 6px var(--highlight, var(--primary));
	}

	.mapsdk-list-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.mapsdk-list-value {
		font-variant-numeric: tabular-nums;
	}

	.mapsdk-list-level {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--muted-foreground);
	}

	.mapsdk-list-swatch {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 999px;
		outline: var(--swatch-outline-width, 1px) solid var(--swatch-outline-color, var(--foreground));
		outline-offset: 1px;
	}

	.mapsdk-list-swatch.neutral {
		background: var(--muted);
	}

	.mapsdk-list-empty {
		margin: 0;
		padding: 0.75rem;
		color: var(--muted-foreground);
	}
</style>
