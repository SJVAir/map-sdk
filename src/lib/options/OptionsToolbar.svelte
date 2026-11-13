<script lang="ts">
	import type { Snippet } from "svelte";
	import { getMapContext } from "../core/context.js";
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
	const wide = $derived(true);

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
			if (wide && !root.contains(e.target as Node)) menus.closeAll();
		};
		document.addEventListener("click", onclick);
		return () => document.removeEventListener("click", onclick);
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== "Escape") return;
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

<div
	bind:this={root}
	class="mapsdk-options"
	role="group"
	aria-label={map.messages("mapsdk_options_toolbar_label")}
	tabindex="-1"
	{onkeydown}
>
	{#each clusters as cluster, i (i)}
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

<style>
	.mapsdk-options {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5rem;
		color: var(--foreground);
		outline: none;
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
