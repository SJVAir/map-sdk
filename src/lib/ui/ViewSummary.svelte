<script lang="ts">
	import { untrack } from "svelte";
	import type { MapContext } from "../core/create-map.svelte.js";
	import { inView } from "./feature-list.js";
	import { SUMMARY_DEBOUNCE_MS, summaryText } from "./view-summary.js";

	let { map }: { map: MapContext } = $props();

	interface Line {
		/** Stable per plugin and kind, so an unchanged line keeps its element and isn't re-announced. */
		key: string;
		text: string;
	}

	// The map's one live region: what is in view per layer, and how many are selected. Spoken text
	// only; the visible pieces are the legend, the list, and the selection bar. Lines are keyed and
	// the region is not atomic, so only a line that changed is announced.
	/** Each plugin's selection count as of the last update, to tell when one drops to zero. */
	let previous: Record<string, number> = {};

	// Selection counts of every plugin, so a change reschedules the update.
	const selectionCounts = $derived(
		map.plugins.map((p) => `${p.id}:${map.getSelection(p.id)?.ids.length ?? 0}`).join(",")
	);

	function compute(): Line[] {
		const bounds = map.bounds;
		const out: Line[] = [];
		const counts: Record<string, number> = {};
		for (const plugin of map.plugins) {
			const layer = plugin.label ?? plugin.id;
			if (bounds && plugin.features) {
				const data = plugin.legend?.();
				const scale = data && "scale" in data ? data.scale : null;
				const shown = inView(plugin.features(), bounds);
				if (shown.length > 0 || plugin.summarizeEmpty !== false) {
					out.push({
						key: `view:${plugin.id}`,
						text: summaryText(layer, shown, scale, map.messages)
					});
				}
			}
			const count = map.getSelection(plugin.id)?.ids.length ?? 0;
			counts[plugin.id] = count;
			// A drop to zero is said once; the line is gone at the next update.
			const selected =
				count > 0
					? map.messages("mapsdk_selected_count", { count })
					: (previous[plugin.id] ?? 0) > 0
						? map.messages("mapsdk_selection_cleared")
						: null;
			if (selected !== null) {
				out.push({
					key: `selection:${plugin.id}`,
					text: map.messages("mapsdk_selected_in_layer", { layer, selected })
				});
			}
		}
		previous = counts;
		return out;
	}

	// What is there at mount (the host's view and selection) is the baseline, not news.
	let lines = $state<Line[]>(untrack(compute));

	let first = true;
	$effect(() => {
		void map.bounds;
		void selectionCounts;
		if (first) {
			first = false;
			return;
		}
		const timer = setTimeout(() => {
			lines = untrack(compute);
		}, SUMMARY_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	});
</script>

<div class="mapsdk-summary" aria-live="polite" aria-atomic="false">
	{#each lines as line (line.key)}
		<p>{line.text}</p>
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
