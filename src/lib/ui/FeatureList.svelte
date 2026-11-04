<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { FeatureListItem } from "../core/plugin.js";
	import { selectionKeys } from "../data/selection.js";
	import { inView, rowLabel, shownLevel, sortItems, typeaheadIndex } from "./feature-list.js";

	interface Props {
		map: MapContext;
		class?: string;
		/** The root element's id, e.g. for a button's `aria-controls`. */
		id?: string;
	}

	let { map, class: className, id }: Props = $props();

	const baseId = $props.id();
	/** Rows rendered above and below the visible ones. */
	const OVERSCAN = 10;
	const TYPEAHEAD_MS = 500;

	type Row = FeatureListItem & { pluginId: string; key: string };

	let sortBy = $state<"name" | "value">("name");
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

	// Every plugin's features in view, re-computed when the view settles (bounds change on
	// moveend) or a plugin's data changes.
	const rows = $derived.by((): Row[] => {
		const bounds = map.bounds;
		const all = map.plugins.flatMap((plugin) => {
			const items = plugin.features?.() ?? [];
			return (bounds ? inView(items, bounds) : items).map((item) => ({
				...item,
				pluginId: plugin.id,
				key: `${plugin.id}\u0000${item.refKey}`
			}));
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

	function optionId(index: number): string {
		return `${baseId}-option-${index}`;
	}

	function isSelectable(row: Row): boolean {
		return row.selectable && map.getSelectionMode(row.pluginId) !== "none";
	}

	function isSelected(row: Row): boolean {
		return selected.get(row.pluginId)?.has(row.refKey) ?? false;
	}

	/** Makes row `index` active: scrolls it into view and focuses (and pans to) its feature. */
	function activate(index: number) {
		const row = rows[index];
		if (!row) return;
		activeKey = row.key;
		if (scroller && rowHeight) {
			const top = index * rowHeight;
			if (top < scroller.scrollTop) scroller.scrollTop = top;
			else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) {
				scroller.scrollTop = top + rowHeight - scroller.clientHeight;
			}
			scrollTop = scroller.scrollTop;
		}
		map.focusFeature(row.refKey, row.pluginId);
	}

	function pick(row: Row, additive: boolean) {
		if (isSelectable(row)) map.pickFromList(row.pluginId, row.refKey, additive);
	}

	function pageSize(): number {
		return Math.max(1, Math.floor(viewportHeight / (rowHeight || 1)) - 1);
	}

	async function openMenu() {
		if (activeIndex < 0) return;
		await tick();
		const el = document.getElementById(optionId(activeIndex));
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
			menuSentTimer = setTimeout(() => (menuSent = false), 1000);
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
				if (current >= 0) pick(rows[current], e.key === " ");
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
		const byPointer = pointerFocus;
		pointerFocus = false;
		if (!byPointer && activeIndex < 0 && rows.length > 0) {
			const first = rows.findIndex(isSelected);
			activate(first >= 0 ? first : 0);
		}
	}

	function onblur() {
		pointerFocus = false;
		map.focusFeature(null);
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

	function formatValue(row: Row): string {
		if (row.value === null) return "";
		return typeof row.value === "number" ? map.format.number(row.value) : row.value;
	}

	onDestroy(() => {
		clearTimeout(typeaheadTimer);
		clearTimeout(menuSentTimer);
	});
</script>

<div class={["mapsdk-list", className]} {id} data-mapsdk-map={map.uid}>
	<div class="mapsdk-list-sort">
		<button type="button" aria-pressed={sortBy === "name"} onclick={() => (sortBy = "name")}>
			{map.messages("mapsdk_list_sort_name")}
		</button>
		<button type="button" aria-pressed={sortBy === "value"} onclick={() => (sortBy = "value")}>
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
			class="mapsdk-list-box"
			role="listbox"
			tabindex="0"
			aria-label={map.messages("mapsdk_list_label")}
			aria-multiselectable={multiselectable || undefined}
			aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
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
				{@const isOn = isSelected(row)}
				<!-- Options aren't focused: the listbox holds focus and handles keys (aria-activedescendant). -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
				<div
					id={optionId(index)}
					class="mapsdk-list-row"
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
						{formatValue(row)}{#if row.units && row.value !== null}&nbsp;{row.units}{/if}
					</span>
					<span class="mapsdk-list-level">
						<span class="mapsdk-list-swatch" class:neutral={!level} style:background={level?.color}
						></span>
						{level ? level.label : map.messages("mapsdk_no_level")}
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
		max-width: calc(100vw - 2rem);
		max-height: 100%;
		box-sizing: border-box;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-card, none);
		font-size: 0.875rem;
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

	.mapsdk-list-sort button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
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

	.mapsdk-list-scroll:has(.mapsdk-list-box:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
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

	.mapsdk-list-box:focus-visible .mapsdk-list-row.active {
		outline: 2px solid var(--ring);
		outline-offset: -4px;
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
		font-size: 0.75rem;
	}

	.mapsdk-list-swatch {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 999px;
		outline: 1px solid var(--foreground);
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
