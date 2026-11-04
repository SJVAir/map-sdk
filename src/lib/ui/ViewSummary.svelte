<script lang="ts">
	import { untrack } from "svelte";
	import type { MapContext } from "../core/create-map.svelte.js";
	import { inView } from "./feature-list.js";
	import { SUMMARY_DEBOUNCE_MS, summaryText } from "./view-summary.js";

	let { map }: { map: MapContext } = $props();

	// The map's one live region: what is in view per layer, and how many are selected. Spoken text
	// only; the visible pieces are the legend, the list, and the selection bar.
	let lines = $state<string[]>([]);

	// Selection counts of every plugin, so a change reschedules the update.
	const selectionCounts = $derived(
		map.plugins.map((p) => `${p.id}:${map.getSelection(p.id)?.ids.length ?? 0}`).join(",")
	);

	function compute(): string[] {
		const bounds = map.bounds;
		const out: string[] = [];
		if (bounds) {
			for (const plugin of map.plugins) {
				if (!plugin.features) continue;
				const data = plugin.legend?.();
				const scale = data && "scale" in data ? data.scale : null;
				out.push(
					summaryText(
						plugin.label ?? plugin.id,
						inView(plugin.features(), bounds),
						scale,
						map.messages
					)
				);
			}
		}
		for (const plugin of map.plugins) {
			const count = map.getSelection(plugin.id)?.ids.length ?? 0;
			if (count === 0) continue;
			out.push(
				map.messages("mapsdk_selected_in_layer", {
					layer: plugin.label ?? plugin.id,
					selected: map.messages("mapsdk_selected_count", { count })
				})
			);
		}
		return out;
	}

	$effect(() => {
		void map.bounds;
		void selectionCounts;
		const timer = setTimeout(() => {
			lines = untrack(compute);
		}, SUMMARY_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});
</script>

<div class="mapsdk-summary" aria-live="polite" aria-atomic="true">
	{#each lines as line, i (i)}
		<p>{line}</p>
	{/each}
</div>

<style>
	.mapsdk-summary {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	p {
		margin: 0;
	}
</style>
