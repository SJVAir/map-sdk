<script lang="ts">
	import { onDestroy, onMount, untrack } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import {
		calHeatScorePlugin,
		createMap,
		forecastZonesPlugin,
		hmsFirePlugin,
		hmsSmokePlugin,
		Legend,
		MapView,
		monitorsPlugin,
		regionsPlugin
	} from "../src/lib/index.js";
	import type { MapPlugin } from "../src/lib/core/plugin.js";
	import type {
		DataSource,
		MonitorFeatureProperties,
		SelectionMode,
		SpatialSelection
	} from "../src/lib/data/index.js";
	import { createMonitorsStore } from "../src/lib/stores/index.js";
	import {
		createDateRangeSource,
		type DateRangeSource,
		type SourceKind
	} from "./date-range-source.svelte.js";

	const maptilerKey = import.meta.env.VITE_MAPTILER_KEY ?? "";

	// Left: fed like the dashboard, from date-range sources. Right: the live monitors store.
	// Both use the default providers.
	const left = createMap({ config: { maptilerKey } });
	const right = createMap({ config: { maptilerKey } });
	const live = createMonitorsStore();

	interface Preset {
		kind: SourceKind;
		label: string;
		selectable: boolean;
		plugin(source: DataSource): MapPlugin;
	}

	const presets: Preset[] = [
		{
			kind: "monitors",
			label: "Monitors",
			selectable: true,
			plugin: (source) =>
				monitorsPlugin({
					// The monitors source's features carry the monitor properties.
					source: source as DataSource<MonitorFeatureProperties>,
					layerLabel: "Monitors",
					id: "monitors",
					selectable: true
				})
		},
		{
			kind: "regions",
			label: "Region fill",
			selectable: true,
			plugin: (source) => regionsPlugin({ source, layerLabel: "Counties", id: "regions" })
		},
		{
			kind: "calheatscore",
			label: "CalHeatScore",
			selectable: true,
			plugin: (source) =>
				calHeatScorePlugin({ source, layerLabel: "CalHeatScore", id: "calheatscore" })
		},
		{
			kind: "forecast-zones",
			label: "Forecast zones",
			selectable: true,
			plugin: (source) =>
				forecastZonesPlugin({ source, layerLabel: "Forecast zones", id: "forecast-zones" })
		},
		{
			kind: "hms-smoke",
			label: "HMS smoke",
			selectable: false,
			plugin: (source) => hmsSmokePlugin({ source, layerLabel: "Smoke", id: "hms-smoke" })
		},
		{
			kind: "hms-fire",
			label: "HMS fire",
			selectable: false,
			plugin: (source) => hmsFirePlugin({ source, layerLabel: "Fires", id: "hms-fire" })
		}
	];

	/** Today in Pacific time, `YYYY-MM-DD`, shifted by `days`. */
	function pacificDate(days = 0): string {
		const date = new Date(Date.now() + days * 86_400_000);
		return date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
	}

	const range = $state({ start: pacificDate(-6), end: pacificDate() });
	let mode = $state<SelectionMode>("multiple");
	let hidden = $state(false);
	let theme = $state<"system" | "light" | "dark">("system");
	const enabled = $state<Record<SourceKind, boolean>>({
		monitors: true,
		regions: false,
		calheatscore: false,
		"forecast-zones": false,
		"hms-smoke": false,
		"hms-fire": false
	});
	const sources = new SvelteMap<SourceKind, DateRangeSource>();

	// The monitors selection, shown and edited as JSON (the host side of the two-way sync).
	let monitorsSelection = $state.raw<SpatialSelection | null>(null);
	let selectionText = $state("null");
	let selectionError = $state("");

	function showSelection(sel: SpatialSelection | null) {
		monitorsSelection = sel;
		selectionText = JSON.stringify(sel);
		selectionError = "";
	}

	function isSelection(value: unknown): value is SpatialSelection | null {
		if (value === null) return true;
		if (typeof value !== "object") return false;
		const v = value as Record<string, unknown>;
		return (
			(v.kind === "monitors" || v.kind === "regions") &&
			Array.isArray(v.ids) &&
			v.ids.every((id) => typeof id === "string")
		);
	}

	function onSelectionInput() {
		let parsed: unknown;
		try {
			parsed = JSON.parse(selectionText);
		} catch {
			selectionError = "Not valid JSON.";
			return;
		}
		if (!isSelection(parsed)) {
			selectionError = 'Expected null or { "kind": "monitors", "ids": [...] }.';
			return;
		}
		selectionError = "";
		monitorsSelection = parsed;
		if (enabled.monitors) left.setSelection("monitors", parsed);
	}

	function enable(preset: Preset) {
		const source = createDateRangeSource(preset.kind, range);
		sources.set(preset.kind, source);
		const plugin = preset.plugin(source);
		const isMonitors = preset.kind === "monitors";
		left.addPlugin(plugin, {
			selectionMode: preset.selectable ? mode : "none",
			selection: isMonitors ? monitorsSelection : null,
			onselectionchange: isMonitors ? showSelection : undefined
		});
	}

	function disable(preset: Preset) {
		left.removePlugin(preset.kind);
		sources.get(preset.kind)?.destroy();
		sources.delete(preset.kind);
	}

	function toggle(preset: Preset, on: boolean) {
		enabled[preset.kind] = on;
		if (on) enable(preset);
		else disable(preset);
	}

	function setMode(next: SelectionMode) {
		mode = next;
		for (const preset of presets) {
			if (preset.selectable && enabled[preset.kind]) left.setSelectionMode(preset.kind, next);
		}
	}

	/** A source's status for the layer list: its feature count once ready. */
	function statusText(kind: SourceKind): string {
		const source = sources.get(kind);
		if (!source) return "";
		const status = source.status;
		if (status.state === "ready") return `${source.features?.features.length ?? 0} features`;
		if (status.state === "unavailable") return status.reason;
		return status.state;
	}

	$effect(() => {
		const root = document.documentElement;
		if (theme === "system") delete root.dataset.theme;
		else root.dataset.theme = theme;
	});

	// Counts the map's view reports (on load and after each move), so a test can tell a rebuilt
	// map has loaded even when the camera reads the same.
	let viewUpdates = $state(0);
	$effect(() => {
		void left.camera;
		untrack(() => viewUpdates++);
	});

	const camera = $derived(
		`zoom ${left.camera.zoom.toFixed(2)} · ${left.camera.center[1].toFixed(4)}, ${left.camera.center[0].toFixed(4)}`
	);

	/** The live source's status for the panel. */
	const liveStatus = $derived.by(() => {
		const status = live.dataSource.status;
		if (status.state === "ready")
			return `${live.dataSource.features?.features.length ?? 0} features`;
		if (status.state === "unavailable") return status.reason;
		return status.state;
	});

	onMount(() => {
		for (const preset of presets) if (enabled[preset.kind]) enable(preset);
		right.addPlugin(
			monitorsPlugin({
				source: live.dataSource,
				layerLabel: "Monitors",
				id: "monitors",
				selectable: true
			}),
			{ selectionMode: "multiple" }
		);
		// PM2.5 like the left map. A failure shows as the source's error status (with a retry in
		// the legend), so the rejection needs no handling here.
		live.init("pm25").catch(() => {});
	});

	onDestroy(() => {
		live.dispose();
		left.destroy();
		right.destroy();
		for (const source of sources.values()) source.destroy();
	});
</script>

<header class="demo-header">
	<h1 class="text-lg">map-sdk demo</h1>
	<label for="theme">Theme</label>
	<select id="theme" bind:value={theme}>
		<option value="system">System</option>
		<option value="light">Light</option>
		<option value="dark">Dark</option>
	</select>
</header>

<main class="demo-main">
	<section class="demo-panel" aria-labelledby="left-title">
		<h2 id="left-title" class="text-base">Date-range sources</h2>
		<div class="demo-controls text-sm">
			<fieldset>
				<legend>Layers</legend>
				{#each presets as preset (preset.kind)}
					<label>
						<input
							type="checkbox"
							checked={enabled[preset.kind]}
							onchange={(e) => toggle(preset, e.currentTarget.checked)}
						/>
						{preset.label}
						{#if enabled[preset.kind]}
							<span class="demo-muted">({statusText(preset.kind)})</span>
						{/if}
					</label>
				{/each}
			</fieldset>
			<fieldset>
				<legend>Date range</legend>
				<label>Start <input type="date" bind:value={range.start} /></label>
				<label>End <input type="date" bind:value={range.end} /></label>
			</fieldset>
			<fieldset>
				<legend>Map</legend>
				<label for="selection-mode">Selection mode</label>
				<select
					id="selection-mode"
					value={mode}
					onchange={(e) => setMode(e.currentTarget.value as SelectionMode)}
				>
					<option value="none">None</option>
					<option value="single">Single</option>
					<option value="multiple">Multiple</option>
				</select>
				<label><input type="checkbox" bind:checked={hidden} /> Hide map</label>
				<output data-testid="left-camera" data-view-updates={viewUpdates} class="demo-muted"
					>{camera}</output
				>
			</fieldset>
			<div class="demo-selection">
				<label for="selection-json">Monitors selection (JSON)</label>
				<textarea
					id="selection-json"
					rows="3"
					spellcheck="false"
					bind:value={selectionText}
					oninput={onSelectionInput}
					aria-invalid={selectionError ? "true" : undefined}
					aria-describedby="selection-error"></textarea>
				<span id="selection-error" class="demo-error" aria-live="polite">{selectionError}</span>
			</div>
		</div>
		<MapView map={left} active={!hidden} label="Date-range map" class="demo-map" />
		<Legend map={left} />
	</section>

	<section class="demo-panel" aria-labelledby="right-title">
		<h2 id="right-title" class="text-base">Live monitors</h2>
		<div class="demo-controls text-sm">
			<fieldset>
				<legend>Store</legend>
				<label for="live-entry-type">Pollutant</label>
				<select
					id="live-entry-type"
					value={live.entryType ?? ""}
					disabled={!live.initialized}
					onchange={(e) => live.entryTypeFor(e.currentTarget.value)}
				>
					{#each live.availableEntryTypes as entryType (entryType)}
						<option value={entryType}>{entryType}</option>
					{/each}
				</select>
				<output data-testid="live-status" class="demo-muted">{liveStatus}</output>
			</fieldset>
		</div>
		<MapView map={right} label="Live map" class="demo-map" />
		<Legend map={right} />
	</section>
</main>

<style>
	.demo-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
	}

	h1,
	h2 {
		margin: 0;
		font-weight: 600;
	}

	h1 {
		margin-right: auto;
	}

	.demo-main {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr));
		gap: 1rem;
		padding: 1rem;
	}

	.demo-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.demo-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: flex-start;
		margin: 0;
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--card);
		color: var(--card-foreground);
	}

	.demo-selection {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1 1 14rem;
	}

	input,
	select,
	textarea {
		font: inherit;
		color: var(--foreground);
		background: var(--background);
		border: 1px solid var(--input, var(--border));
		border-radius: var(--radius-control, var(--radius));
	}

	textarea {
		font-family: ui-monospace, monospace;
		padding: 0.25rem 0.5rem;
	}

	input:focus-visible,
	select:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
		box-shadow: 0 0 0 4px var(--ring-edge, var(--background));
	}

	.demo-muted {
		color: var(--muted-foreground);
	}

	.demo-error {
		color: var(--destructive);
		min-height: 1lh;
	}

	:global(.demo-map) {
		height: 32rem;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius);
		overflow: hidden;
	}
</style>
