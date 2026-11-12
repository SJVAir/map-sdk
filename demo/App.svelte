<script lang="ts">
	import { onDestroy, onMount, untrack } from "svelte";
	import { SvelteMap } from "svelte/reactivity";
	import {
		calHeatScorePlugin,
		collocationSitesPlugin,
		createMap,
		defaultBasemaps,
		focusAreaPlugin,
		forecastZonesPlugin,
		hmsFirePlugin,
		hmsSmokePlugin,
		Legend,
		MapView,
		monitorsPlugin,
		pointsPlugin,
		regionsPlugin,
		schoolsPlugin,
		type CardContext,
		type ListPosition
	} from "../src/lib/index.js";
	import type { MapPlugin } from "../src/lib/core/plugin.js";
	import { staticSource } from "../src/lib/data/index.js";
	import type {
		DataSource,
		MapFeatureProperties,
		MonitorFeatureProperties,
		SchoolsSource,
		SelectionMode,
		SpatialSelection
	} from "../src/lib/data/index.js";
	import {
		createCollocationSitesStore,
		createHmsFireStore,
		createHmsSmokeStore,
		createMonitorsStore
	} from "../src/lib/stores/index.js";
	import {
		createDateRangeSource,
		type DateRangeSource,
		type SourceKind
	} from "./date-range-source.svelte.js";
	import { focusChoices } from "./focus-areas.js";

	const maptilerKey = import.meta.env.VITE_MAPTILER_KEY ?? "";

	// Left: fed like the dashboard, from date-range sources. Right: the live monitors store.
	// Both use the default providers.
	const left = createMap({ config: { maptilerKey } });
	const right = createMap({ config: { maptilerKey } });
	const live = createMonitorsStore();

	// The live map: today's monitor-map setup (globe, space, Streets v4 with every layer, live
	// stores, click eases to zoom 12), on its own stores.
	const today = createMap({
		config: {
			maptilerKey,
			initialView: {
				center: [-119.7987626619462, 36.76272050981146],
				zoom: 7,
				bearing: 0,
				pitch: 0
			},
			projection: "globe",
			space: { preset: "milkyway" },
			basemaps: { ...defaultBasemaps(), excludedLayers: [] }
		}
	});
	// Focus areas, one plugin per map. "Your location" sits by the e2e fixture's Fixture Alpha.
	const FOCUS_CHOICES = focusChoices([-119.74726, 36.874092]);
	const todayFocus = focusAreaPlugin({ id: "focus", layerLabel: "Places" });
	const rightFocus = focusAreaPlugin({ id: "focus", layerLabel: "Places" });
	let todayFocusKey = $state("none");
	let rightFocusKey = $state("none");
	function focusOn(plugin: typeof todayFocus, key: string) {
		const choice = FOCUS_CHOICES.find((c) => c.key === key) ?? FOCUS_CHOICES[0];
		plugin.set({ geometry: choice.geometry, label: choice.pinLabel });
	}
	$effect(() => focusOn(todayFocus, todayFocusKey));
	$effect(() => focusOn(rightFocus, rightFocusKey));

	const todayMonitors = createMonitorsStore();
	const todaySmoke = createHmsSmokeStore();
	const todayFire = createHmsFireStore();
	const todaySites = createCollocationSitesStore({ monitors: todayMonitors });

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

	/** Draw order, bottom first: fills, then smoke, fire, and monitors on top. */
	const drawOrder: SourceKind[] = [
		"regions",
		"calheatscore",
		"forecast-zones",
		"hms-smoke",
		"hms-fire",
		"monitors"
	];

	/** The first added plugin that draws above `kind`, so it goes below it whatever the toggle order. */
	function pluginAbove(kind: SourceKind): string | undefined {
		const added = new Set(untrack(() => left.plugins).map((p) => p.id));
		return drawOrder.slice(drawOrder.indexOf(kind) + 1).find((k) => added.has(k));
	}

	/** Today in Pacific time, `YYYY-MM-DD`, shifted by `days`. */
	function pacificDate(days = 0): string {
		const date = new Date(Date.now() + days * 86_400_000);
		return date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
	}

	const range = $state({ start: pacificDate(-6), end: pacificDate() });
	let mode = $state<SelectionMode>("multiple");
	let hidden = $state(false);
	let theme = $state<"system" | "light" | "dark">("system");
	// The setup map's List button: monitor-map uses top-right, shown only on keyboard focus.
	let listPosition = $state<ListPosition>("top-left");
	let listFocusOnly = $state(false);
	// A host card around the setup map's legend (framed={false}), and sample EV chargers: a plugin
	// with no scale whose list rows and tooltips show a detail in place of "No level".
	let legendInCard = $state(false);
	let showChargers = $state(false);
	const chargers = pointsPlugin<MapFeatureProperties & { detail: string }>({
		id: "ev-sample",
		layerLabel: "EV chargers (sample)",
		circle: { radius: 7 },
		detail: (p) => p.detail,
		source: staticSource(
			{
				type: "FeatureCollection",
				features: [
					[-119.79, 36.74, "Fresno Station A", "Level 2 charger"],
					[-119.77, 36.81, "Fresno Station B", "Level 3 charger"],
					[-119.72, 36.78, "Clovis Station", "Level 2 charger"]
				].map(([lng, lat, name, detail], i) => ({
					type: "Feature" as const,
					geometry: { type: "Point" as const, coordinates: [lng as number, lat as number] },
					properties: {
						refKey: `feature:ev-${i}`,
						name: name as string,
						value: null,
						detail: detail as string
					}
				}))
			},
			null
		)
	});
	// Schools and child care, loaded by the host (map-sdk never fetches): the endpoint's features
	// passed through as they are.
	let showSchools = $state(false);
	const schoolsSource = $state<{ -readonly [K in keyof SchoolsSource]: SchoolsSource[K] }>({
		status: { state: "loading" },
		features: null
	});
	const schools = schoolsPlugin({ source: schoolsSource, layerLabel: "Schools and child care" });
	let schoolsLoaded = false;
	async function loadSchools() {
		schoolsSource.status = { state: "loading" };
		try {
			// The endpoint's GeoJSON as it is (the demo's SDK is older than its source and
			// external_id fields).
			const response = await fetch("/api/2.0/pesticides/locations/?bbox=-120.2,36.5,-119.4,37.0");
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			schoolsSource.features = (await response.json()) as SchoolsSource["features"];
			schoolsSource.status = { state: "ready" };
			schoolsLoaded = true;
		} catch (error) {
			schoolsSource.status = { state: "error", error, retry: () => void loadSchools() };
		}
	}
	function toggleSchools(on: boolean) {
		showSchools = on;
		// Above the focus area, under the monitors.
		if (on) right.addPlugin(schools, { before: "monitors" });
		else right.removePlugin(schools.id);
		if (on && !schoolsLoaded) void loadSchools();
	}
	// For e2e: the last featureclick, with the host's properties.
	let lastClick = $state<unknown>(null);
	function toggleChargers(on: boolean) {
		showChargers = on;
		if (on) today.addPlugin(chargers);
		else today.removePlugin(chargers.id);
	}
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
			before: pluginAbove(preset.kind),
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

	/** The live map's monitors status for the panel. */
	const todayStatus = $derived.by(() => {
		const status = todayMonitors.dataSource.status;
		if (status.state === "ready")
			return `${todayMonitors.dataSource.features?.features.length ?? 0} features`;
		if (status.state === "unavailable") return status.reason;
		return status.state;
	});

	onMount(() => {
		// For e2e only: the maps, so a test can project a monitor to a screen point.
		if (import.meta.env.DEV) {
			(window as unknown as { __mapsdkDemo: object }).__mapsdkDemo = {
				left,
				right,
				today,
				schools,
				rightFocus,
				get lastClick() {
					return lastClick;
				}
			};
		}
		// Bottom to top, as monitor-map draws: smoke, fire (groups below zoom 10, hotspots from
		// it), collocation sites, monitors. The focus area goes under them all.
		today.addPlugin(todayFocus);
		today.addPlugin(
			hmsSmokePlugin({ source: todaySmoke.dataSource, layerLabel: "Smoke", id: "hms-smoke" })
		);
		today.addPlugin(
			hmsFirePlugin({
				source: todayFire.groups,
				hotspots: todayFire.hotspots,
				layerLabel: "Fires",
				id: "hms-fire"
			})
		);
		today.addPlugin(
			collocationSitesPlugin({
				source: todaySites.dataSource,
				layerLabel: "Collocation sites"
			})
		);
		today.addPlugin(
			monitorsPlugin({
				source: todayMonitors.dataSource,
				layerLabel: "Monitors",
				id: "monitors",
				selectable: true,
				selectedStyle: "enlarge"
			}),
			{ selectionMode: "single" }
		);
		today.on("featureclick", (e) => today.easeTo({ center: e.lngLat, minZoom: 12 }));
		todayMonitors.init("pm25").catch(() => {});
		todaySmoke.init().catch(() => {});
		todayFire.init().catch(() => {});
		todaySites.init().catch(() => {});
		for (const preset of presets) if (enabled[preset.kind]) enable(preset);
		right.addPlugin(rightFocus);
		right.on("featureclick", (e) => (lastClick = $state.snapshot(e)));
		right.addPlugin(
			monitorsPlugin({
				source: live.dataSource,
				layerLabel: "Monitors",
				id: "monitors",
				selectable: true
			}),
			{
				selectionMode: "multiple",
				// The dashboard's widget pattern: a plain click shows the card, Shift-click (or the
				// card's Select) selects, up to 3.
				pickWith: "modifier",
				canSelect: (next) => (next?.ids.length ?? 0) <= 3 || "Up to 3 monitors"
			}
		);
		// PM2.5 like the left map. A failure shows as the source's error status (with a retry in
		// the legend), so the rejection needs no handling here.
		live.init("pm25").catch(() => {});
	});

	onDestroy(() => {
		todayMonitors.dispose();
		todaySmoke.dispose();
		todayFire.dispose();
		todaySites.dispose();
		today.destroy();
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

{#snippet liveCardActions(card: CardContext)}
	{#if card.selectable}
		<button type="button" class="demo-card-button" onclick={() => card.toggle()}>
			{card.selected ? "Remove" : "Select"}
		</button>
	{/if}
{/snippet}

<main class="demo-main">
	<section class="demo-panel demo-wide" aria-labelledby="today-title">
		<h2 id="today-title" class="text-base">Live map (monitor-map setup)</h2>
		<div class="demo-controls text-sm">
			<fieldset>
				<legend>Store</legend>
				<label for="today-entry-type">Pollutant</label>
				<select
					id="today-entry-type"
					value={todayMonitors.entryType ?? ""}
					disabled={!todayMonitors.initialized}
					onchange={(e) => todayMonitors.entryTypeFor(e.currentTarget.value)}
				>
					{#each todayMonitors.availableEntryTypes as entryType (entryType)}
						<option value={entryType}>{entryType}</option>
					{/each}
				</select>
				<output data-testid="today-status" class="demo-muted">{todayStatus}</output>
			</fieldset>
			<fieldset>
				<legend>Focus</legend>
				<label for="today-focus">Focus area</label>
				<select id="today-focus" bind:value={todayFocusKey}>
					{#each FOCUS_CHOICES as choice (choice.key)}
						<option value={choice.key}>{choice.label}</option>
					{/each}
				</select>
			</fieldset>
			<fieldset>
				<legend>List button</legend>
				<label for="today-list-position">List button corner</label>
				<select id="today-list-position" bind:value={listPosition}>
					<option value="top-left">Top left</option>
					<option value="top-right">Top right</option>
					<option value="bottom-left">Bottom left</option>
					<option value="bottom-right">Bottom right</option>
				</select>
				<label>
					<input type="checkbox" bind:checked={listFocusOnly} />
					Show the List button only on keyboard focus
				</label>
			</fieldset>
			<fieldset>
				<legend>Host options</legend>
				<label>
					<input type="checkbox" bind:checked={legendInCard} />
					Legend in a host card
				</label>
				<label>
					<input
						type="checkbox"
						checked={showChargers}
						onchange={(e) => toggleChargers(e.currentTarget.checked)}
					/>
					Sample EV chargers
				</label>
			</fieldset>
		</div>
		<MapView
			map={today}
			label="Monitor-map setup map"
			controls="engine"
			selectionBar={false}
			tooltip="pointer"
			featureList={{ position: listPosition, reveal: listFocusOnly ? "focus" : "always" }}
			class="demo-map demo-map-tall"
		/>
		{#if legendInCard}
			<div class="demo-legend-card">
				<h3 class="text-sm">Legend</h3>
				<Legend map={today} order="top-first" framed={false} />
			</div>
		{:else}
			<Legend map={today} order="top-first" />
		{/if}
	</section>

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
			<fieldset>
				<legend>Focus</legend>
				<label for="right-focus">Focus area</label>
				<select id="right-focus" bind:value={rightFocusKey}>
					{#each FOCUS_CHOICES as choice (choice.key)}
						<option value={choice.key}>{choice.label}</option>
					{/each}
				</select>
				<label>
					<input
						type="checkbox"
						checked={showSchools}
						onchange={(e) => toggleSchools(e.currentTarget.checked)}
					/>
					Schools and child care
				</label>
			</fieldset>
		</div>
		<MapView map={right} label="Live map" class="demo-map" card={{ actions: liveCardActions }} />
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

	.demo-wide {
		grid-column: 1 / -1;
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

	.demo-legend-card {
		width: 21rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card, var(--background));
	}

	.demo-legend-card h3 {
		margin: 0 0 0.5rem;
	}

	/* The Live map card's Select/Remove: a host's own button, in theme tokens. */
	.demo-card-button {
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--primary);
		color: var(--primary-foreground);
		font: inherit;
		cursor: pointer;
	}

	:global(.demo-map-tall) {
		height: 40rem;
	}
</style>
