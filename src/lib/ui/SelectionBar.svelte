<script lang="ts">
	import type { MapContext } from "../core/create-map.svelte.js";
	import "./controls.css";

	interface Props {
		map: MapContext;
		/** Leaves room at the right for a top-right List button, as the bar does at the left. */
		clearRight?: boolean;
	}

	let { map, clearRight = false }: Props = $props();

	let bar: HTMLElement | undefined = $state();

	// Every id counts, whether or not it is in the data: a host may select features that load later.
	const entries = $derived(
		map.plugins.flatMap((plugin) => {
			const count = map.getSelection(plugin.id)?.ids.length ?? 0;
			return count > 0 ? [{ id: plugin.id, layer: plugin.label ?? plugin.id, count }] : [];
		})
	);

	/**
	 * Clears one plugin's selection. The button is about to go (or its row is), so focus moves
	 * first: to another plugin's Clear button, else the List button, else the map region.
	 */
	function clear(id: string, button: HTMLElement) {
		const another = [...(bar?.querySelectorAll<HTMLElement>("button") ?? [])].find(
			(b) => b !== button
		);
		const region = bar?.closest<HTMLElement>("[data-mapsdk-map]");
		const target = another ?? region?.querySelector<HTMLElement>(".mapsdk-list-button") ?? region;
		if (target === region && region && !region.hasAttribute("tabindex")) {
			region.setAttribute("tabindex", "-1");
		}
		target?.focus();
		map.clearSelection(id);
	}
</script>

{#if entries.length > 0}
	<div
		bind:this={bar}
		class={["mapsdk-selection text-sm", clearRight && "mapsdk-selection-clear-right"]}
		role="group"
		aria-label={map.messages("mapsdk_selection_label")}
	>
		{#each entries as entry (entry.id)}
			{@const selected = map.messages("mapsdk_selected_count", { count: entry.count })}
			<div class="mapsdk-selection-row">
				<span>
					{entries.length > 1
						? map.messages("mapsdk_selected_in_layer", { layer: entry.layer, selected })
						: selected}
				</span>
				<button
					type="button"
					class="mapsdk-focus mapsdk-motion"
					aria-label={map.messages("mapsdk_selection_clear_layer", { layer: entry.layer })}
					onclick={(e) => clear(entry.id, e.currentTarget)}
				>
					{map.messages("mapsdk_selection_clear")}
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.mapsdk-selection {
		position: absolute;
		top: 0.75rem;
		/* Clear of the List button (left) and the zoom buttons (right); centered between them. */
		right: 4rem;
		left: 5rem;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		box-sizing: border-box;
		width: fit-content;
		margin-inline: auto;
		padding: 0.375rem 0.5rem 0.375rem 0.75rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-card, none);
		pointer-events: auto;
	}

	.mapsdk-selection-clear-right {
		right: 5rem;
	}

	.mapsdk-selection-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem 0.75rem;
	}

	.mapsdk-selection-row span {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	button {
		flex: none;
		padding: 0.25rem 0.625rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		font: inherit;
		cursor: pointer;
	}

	button:hover {
		background: var(--accent, var(--muted));
	}
</style>
