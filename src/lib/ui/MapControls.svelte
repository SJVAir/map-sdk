<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import "./controls.css";
	import type { MapContext } from "../core/create-map.svelte.js";
	import type { GlMapLike } from "../core/gl.js";

	interface Props {
		map: MapContext;
		/** The live GL map; the zoom buttons do nothing while it is `null`. */
		gl: GlMapLike | null;
	}

	let { map, gl }: Props = $props();

	// MapTiler's terms require its logo and "© MapTiler © OpenStreetMap contributors" credits on a
	// map that uses its tiles. The SDK's own logo control uses this hosted file (the package
	// doesn't ship the asset); MapView turns the SDK's controls off, so they are drawn here.
	const MAPTILER_URL = "https://www.maptiler.com/";
	const MAPTILER_LOGO = "https://api.maptiler.com/resources/logo.svg";
	const MAPTILER_COPYRIGHT = "https://www.maptiler.com/copyright/";
	const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";

	const datasets = $derived([
		...new Set(map.plugins.flatMap((plugin) => (plugin.dataset ? [plugin.dataset] : [])))
	]);
	let fetched = $state.raw<Record<string, string>>({});
	const dataCredits = $derived([
		...new Set(datasets.flatMap((d) => (fetched[d] ? [fetched[d]] : [])))
	]);

	// An unavailable attribution is tried again on a later moveend, at most once a minute.
	const RETRY_MS = 60_000;
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

	function zoomBy(delta: number) {
		if (!gl) return;
		const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		gl.easeTo({ zoom: gl.getZoom() + delta, ...(reduced && { duration: 0 }) });
	}
</script>

<div class="mapsdk-zoom" role="group" aria-label={map.messages("mapsdk_controls_label")}>
	<button type="button" class="mapsdk-focus mapsdk-motion" disabled={!gl} onclick={() => zoomBy(1)}>
		<span class="mapsdk-zoom-icon" aria-hidden="true">+</span>
		<span class="mapsdk-sr">{map.messages("mapsdk_zoom_in")}</span>
		<span class="mapsdk-zoom-tip mapsdk-motion text-xs" aria-hidden="true"
			>{map.messages("mapsdk_zoom_in")}</span
		>
	</button>
	<button
		type="button"
		class="mapsdk-focus mapsdk-motion"
		disabled={!gl}
		onclick={() => zoomBy(-1)}
	>
		<span class="mapsdk-zoom-icon" aria-hidden="true">&minus;</span>
		<span class="mapsdk-sr">{map.messages("mapsdk_zoom_out")}</span>
		<span class="mapsdk-zoom-tip mapsdk-motion text-xs" aria-hidden="true"
			>{map.messages("mapsdk_zoom_out")}</span
		>
	</button>
</div>

<div class="mapsdk-credits text-xs">
	<a class="mapsdk-logo mapsdk-focus" href={MAPTILER_URL} target="_blank" rel="noopener">
		<img src={MAPTILER_LOGO} alt={map.messages("mapsdk_logo_maptiler")} width="80" height="24" />
	</a>
	<ul aria-label={map.messages("mapsdk_attribution_label")}>
		{#each dataCredits as credit (credit)}
			<li>{credit}</li>
		{/each}
		<li>
			<a class="mapsdk-focus" href={MAPTILER_COPYRIGHT} target="_blank" rel="noopener">
				{map.messages("mapsdk_credit_maptiler")}
			</a>
		</li>
		<li>
			<a class="mapsdk-focus" href={OSM_COPYRIGHT} target="_blank" rel="noopener">
				{map.messages("mapsdk_credit_osm")}
			</a>
		</li>
	</ul>
</div>

<style>
	.mapsdk-zoom {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 2;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		box-shadow: var(--shadow-card, none);
		pointer-events: auto;
	}

	.mapsdk-zoom button {
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--foreground);
		font: inherit;
		cursor: pointer;
	}

	.mapsdk-zoom button + button {
		border-top: 1px solid var(--card-border, var(--border));
	}

	.mapsdk-zoom button:disabled {
		color: var(--muted-foreground);
		cursor: default;
	}

	.mapsdk-zoom button {
		position: relative;
	}

	/* The hover fill follows the group's rounded corners. */
	.mapsdk-zoom button:first-child {
		border-radius: var(--radius-control, var(--radius)) var(--radius-control, var(--radius)) 0 0;
	}

	.mapsdk-zoom button:last-child {
		border-radius: 0 0 var(--radius-control, var(--radius)) var(--radius-control, var(--radius));
	}

	.mapsdk-zoom button:hover:not(:disabled) {
		background: var(--accent, var(--muted));
	}

	/* Above the next button, so the ring isn't cut by it. */
	.mapsdk-zoom button:focus-visible {
		z-index: 1;
	}

	/* The visible name: on hover and focus, left of the button; the screen-reader text stays. */
	.mapsdk-zoom-tip {
		position: absolute;
		top: 50%;
		right: calc(100% + 0.5rem);
		padding: 0.125rem 0.5rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--popover, var(--background));
		color: var(--popover-foreground, var(--foreground));
		box-shadow: var(--shadow-lifted, var(--shadow-card, none));
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
		transform: translateY(-50%);
	}

	.mapsdk-zoom button:hover .mapsdk-zoom-tip,
	.mapsdk-zoom button:focus-visible .mapsdk-zoom-tip {
		opacity: 1;
	}

	.mapsdk-zoom-icon {
		font-size: 1.25rem;
		line-height: 1;
	}

	.mapsdk-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.mapsdk-credits {
		position: absolute;
		right: 0.75rem;
		bottom: 0.75rem;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: calc(100% - 1.5rem);
		padding: 0.25rem 0.5rem;
		border-radius: var(--radius-control, var(--radius));
		background: var(--overlay, var(--background));
		color: var(--foreground);
		pointer-events: auto;
	}

	.mapsdk-credits ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mapsdk-credits a {
		color: var(--link, var(--primary));
	}

	.mapsdk-logo {
		display: block;
		flex: none;
	}

	.mapsdk-logo img {
		display: block;
		object-fit: contain;
	}
</style>
