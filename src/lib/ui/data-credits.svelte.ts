/* eslint-disable svelte/prefer-svelte-reactivity -- derived sets only dedupe; never mutated */
import { onDestroy, untrack } from "svelte";
import type { MapContext } from "../core/create-map.svelte.js";

/** An unavailable attribution is tried again on a later moveend, at most once a minute. */
const RETRY_MS = 60_000;

/**
 * The credit text of every dataset the map's plugins declare, each once, as it arrives from the
 * metadata provider. Call during a component's initialization: the fetching runs in an effect
 * and stops with the component.
 */
export function createDataCredits(map: MapContext): { readonly list: string[] } {
	const datasets = $derived([
		...new Set(map.plugins.flatMap((plugin) => (plugin.dataset ? [plugin.dataset] : [])))
	]);
	let fetched = $state.raw<Record<string, string>>({});
	const list = $derived([...new Set(datasets.flatMap((d) => (fetched[d] ? [fetched[d]] : [])))]);

	const controller = new AbortController();
	onDestroy(() => controller.abort());
	// Plain collections: bookkeeping, never rendered.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const inflight = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const failedAt = new Map<string, number>();

	$effect(() => {
		void map.bounds;
		const wanted = datasets;
		untrack(() => {
			for (const dataset of wanted) {
				if (fetched[dataset] || inflight.has(dataset)) continue;
				const failed = failedAt.get(dataset);
				if (failed !== undefined && Date.now() - failed < RETRY_MS) continue;
				inflight.add(dataset);
				map.metadata.attribution(dataset, controller.signal).then(
					(text) => {
						inflight.delete(dataset);
						if (controller.signal.aborted) return;
						if (text === "unavailable") failedAt.set(dataset, Date.now());
						else fetched = { ...fetched, [dataset]: text };
					},
					() => {
						inflight.delete(dataset);
						failedAt.set(dataset, Date.now());
					}
				);
			}
		});
	});

	return {
		get list() {
			return list;
		}
	};
}
