<script lang="ts">
	import type { MapContext } from "../core/create-map.svelte.js";

	let { map }: { map: MapContext } = $props();

	// Every id counts, whether or not it is in the data: a host may select features that load later.
	const entries = $derived(
		map.plugins.flatMap((plugin) => {
			const count = map.getSelection(plugin.id)?.ids.length ?? 0;
			return count > 0 ? [{ id: plugin.id, layer: plugin.label ?? plugin.id, count }] : [];
		})
	);
</script>

{#if entries.length > 0}
	<div class="mapsdk-selection" role="group" aria-label={map.messages("mapsdk_selection_label")}>
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
					aria-label={map.messages("mapsdk_selection_clear_layer", { layer: entry.layer })}
					onclick={() => map.clearSelection(entry.id)}
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
		left: 50%;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-width: calc(100% - 16rem);
		transform: translateX(-50%);
		padding: 0.375rem 0.5rem 0.375rem 0.75rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-card, none);
		font-size: 0.875rem;
		pointer-events: auto;
	}

	.mapsdk-selection-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	button {
		padding: 0.25rem 0.625rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		font: inherit;
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
