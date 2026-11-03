# `@sjvair/map-sdk` Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first `0.x` of `@sjvair/map-sdk`: a Svelte 5 library for any number of
independent SJVAir maps per page, with general points and shapes plugins, six dataset presets,
host-owned selection, accessible on-screen pieces, three providers with defaults,
`createMonitorsStore()`, and a demo page.

**Architecture:** A `MapContext` (from `createMap`) holds all state and outlives the GL map.
`MapView` attaches and detaches a MapTiler map. A plugin host runs plugin `setup`/teardown
against a narrow `GlMapLike` interface, so the core and plugins are tested against a fake map.
Data sources and providers live in a `/data` entry, and stores in a `/stores` entry, and
neither may reach the map engine.

**Tech Stack:** Node 26, Svelte 5 (runes), TypeScript 6, Vite 8, `@sveltejs/package`,
Tailwind v4, `@maptiler/sdk` 4, `@turf/clusters-dbscan` and `@turf/helpers`, `color2k`,
`@sjvair/sdk` (peer, `npm:@jsr/sjvair__sdk`), bits-ui (peer), Vitest 5 (unit, client, and
browser projects), Playwright with `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-11-03-map-sdk-design.md` (approved 2026-11-03). Read it
before any task; the plan argues from it.

## Global Constraints

- License MIT, `Copyright (c) 2026 Central California Asthma Collaborative (SJVAir)` (already in
  `LICENSE`). Bundled dependencies only MIT, BSD, Apache-2.0, ISC, MPL-2.0 (unmodified), or
  OFL-1.1 (fonts only). Never add `@maptiler/weather`.
- Browsers: Chrome/Edge 111+, Safari 16.4+, Firefox 128+ (Vite `build.target`
  `["chrome111", "edge111", "firefox128", "safari16.4"]`).
- Svelte 5 runes only. Tabs, double quotes, no trailing commas, print width 100. Prettier +
  ESLint flat config (copy data-dashboard's `.prettierrc` and monitor-map's `eslint.config.js`).
- Never give a component and a `.svelte.ts` module the same base name in one folder; import rune
  modules with their full extension (`./foo.svelte.js`).
- Nothing module-global: no singletons, no state at module level except pure constants.
- No hardcoded labels, units, breakpoints, colors, or scales. They come from a `Scale` or the
  metadata provider. Monitor-type marker shapes and fire icon sizes are presentation and may
  live in code.
- Every UI string is a message key `mapsdk_*` with an English default in
  `src/lib/data/messages/en.json`. No concatenated sentences.
- All date and time formatting in America/Los_Angeles through the `format` provider.
- Components use only theme tokens: shadcn names (`--background`, `--foreground`, `--card`,
  `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`, `--muted-foreground`,
  `--border`, `--ring`, `--radius`) and family tokens with fallbacks:
  `var(--highlight, var(--primary))`, `var(--highlight-subtle, var(--muted))`,
  `var(--highlight-foreground, var(--primary-foreground))`, `var(--card-border, var(--border))`,
  `var(--shadow-card, none)`, `var(--radius-control, var(--radius))`,
  `var(--overlay, var(--background))`, `var(--link, var(--primary))`. `--highlight` never for
  text. Never assume a `.dark` class.
- Color never carries meaning alone: every level color is shown with its label; swatches have a
  3:1 contrasting outline; selection is a `--highlight` ring plus a check mark.
- Respect `prefers-reduced-motion`: no animated camera moves when set.
- Specs live in top-level `tests/`, never in `src/lib` (they would ship).
- Never publish to npm or JSR, create a tag or GitHub Release, or push, without the user's
  explicit yes for that specific action.
- Commits: plain messages, no AI attribution lines.

## Review Focus

1. **Two maps on one page.** Selecting, hovering, or changing the basemap on map A must not
   touch map B, and source and layer ids must never collide. (Task 9 and Task 12 tests.)
2. **Hide and show quickly, or hide during a basemap load.** Detaching while a style is loading,
   or attaching again at once, must leave no stale layers, handlers, or images, and no plugin
   `setup` running against a dead map. (Task 8 test.)
3. **Values the scale doesn't cover.** A null value, a negative value, a value at exactly a
   level's `max`, or a level with an empty `color`: neutral fill, a "No level" label, never a
   crash (monitor-map's `darken("")` crash). (Task 3 and Task 13 tests.)
4. **Host selection that names features not in the data.** Kept in the selection and counted in
   the selection bar, never silently dropped; a feature that appears later shows as selected.
   (Task 4 and Task 10 tests.)
5. **Data changing while the map is detached.** On re-attach the map shows the latest features
   and selection, not the state at detach. (Task 14 test.)

---

## File structure

```
package.json, vite.config.ts, vitest.config.ts, svelte.config.js, tsconfig.json,
eslint.config.js, .prettierrc, .prettierignore, .nvmrc, .env.example, playwright.config.ts
.github/workflows/ci.yml            lint, check, unit/client/browser tests, bundle and license checks, e2e
.github/workflows/release.yml       npm publish on a GitHub Release (never triggered by the agent)
scripts/check-bundle.mjs            /stores and /data must not reach maplibre/maptiler
scripts/check-licenses.mjs          production dependency licenses against the allowed list
src/lib/index.ts                    root entry
src/lib/data/index.ts               /data entry
src/lib/data/types.ts               FeatureRef, refKey, MapFeatureProperties, DataSource, DataStatus, SelectionMode
src/lib/data/scale-types.ts         Scale, Level, ScaleRef (mirror of the server shape; Task 25 swaps to @sjvair/sdk)
src/lib/data/refs.ts                encodeRef, decodeRef, toPlaceRef, fromPlaceRef
src/lib/data/scale.ts               levelFor, scaleFromLegacyLevels, NO_LEVEL
src/lib/data/selection.ts           applyPick, selectionKeys, emptySelection
src/lib/data/static-source.ts       staticSource (plain GeoJSON data source)
src/lib/data/messages/en.json       English catalog (inlang message format)
src/lib/data/messages.ts            MessageKey, MessageProvider, defaultMessages
src/lib/data/format.ts              FormatProvider, defaultFormat
src/lib/data/metadata.ts            MetadataProvider, createDefaultMetadata
src/lib/stores/index.ts             /stores entry
src/lib/stores/abort.ts             anySignal, untilAborted (ported)
src/lib/stores/monitors-store.svelte.ts   createMonitorsStore
src/lib/core/gl.ts                  GlMapLike interface (types only)
src/lib/core/plugin.ts              MapPlugin, PluginContext, FeatureHit, FeatureListItem, LegendData types
src/lib/core/plugin-host.svelte.ts  PluginHost (lifecycle, namespacing, auto-cleanup)
src/lib/core/interactions.ts        InteractionRouter (click/hover/tooltip routing, featuresAt)
src/lib/core/basemap.svelte.ts      BasemapState (switching and fallback)
src/lib/core/create-map.svelte.ts   createMap, MapContext
src/lib/core/context.ts             setMapContext, getMapContext (Svelte context)
src/lib/view/create-gl-map.ts       the only runtime import of @maptiler/sdk outside plugins
src/lib/view/MapView.svelte
src/lib/plugins/style.ts            scale → MapLibre expressions
src/lib/plugins/icons.ts            ported SVG shapes, fire icon, selected check overlay
src/lib/plugins/points.svelte.ts    pointsPlugin
src/lib/plugins/shapes.svelte.ts    shapesPlugin
src/lib/presets/monitors.ts, regions.ts, calheatscore.ts, forecast-zones.ts, hms-smoke.ts, hms-fire.ts, fire-groups.ts
src/lib/ui/legend-data.ts, Legend.svelte, LegendBar.svelte
src/lib/ui/MapTooltip.svelte
src/lib/ui/feature-list.ts, FeatureList.svelte
src/lib/ui/view-summary.ts, ViewSummary.svelte, SelectionBar.svelte, MapControls.svelte
src/lib/ui/theme.css                token fallbacks as Tailwind @theme inline aliases
demo/index.html, demo/main.ts, demo/App.svelte, demo/date-range-source.svelte.ts
tests/unit/**  tests/client/**  tests/browser/**  tests/fixtures/**  e2e/**
README.md, CLAUDE.md
```

---

### Task 1: Scaffold the package and tooling

**Files:**

- Create: `package.json`, `vite.config.ts`, `vitest.config.ts`, `svelte.config.js`,
  `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.nvmrc`,
  `.env.example`, `.github/workflows/ci.yml`, `src/lib/index.ts`, `tests/unit/package.test.ts`

**Interfaces:**

- Produces: scripts `dev`, `build` (`svelte-package -i src/lib -o dist`), `check`, `lint`,
  `format`, `test` (all Vitest projects), `test:unit`, `test:client`, `test:browser`,
  `test:bundle`, `test:licenses`, `test:e2e`. Vitest projects `unit` (`tests/unit/**`, server
  compile), `client` (`tests/client/**`, client compile so `$effect` runs, no DOM, monitor-map's
  `tests/client/environment.ts` approach), `browser` (`tests/browser/**`, Vitest browser mode,
  Playwright Chromium, `vitest-browser-svelte`).

- [ ] **Step 1: Write `package.json`**: name `@sjvair/map-sdk`, version `0.1.0-dev.0`,
      `"license": "MIT"`, `"type": "module"`, `engines.node` `">=26 <27"`, repository
      `https://github.com/SJVAir/map-sdk`, `files: ["dist"]`, `sideEffects: ["**/*.css"]`, and
      `exports` for `.`, `./stores`, `./data`, `./messages/en.json`, `./theme.css`, each with
      `svelte`/`types`/`default` conditions into `dist/`. Peer dependencies: `svelte ^5.57.0`,
      `@sjvair/sdk` (`npm:@jsr/sjvair__sdk@^4.8.0-beta.3`), `bits-ui ^2.19.2`. Dependencies:
      `@maptiler/sdk ^4.1.0`, `@turf/clusters-dbscan ^7.4.0`, `@turf/helpers ^7.4.0`,
      `@types/geojson`, `color2k ^2.0.4`. Dev dependencies at monitor-map's and data-dashboard's
      versions (Svelte, Vite 8, Vitest 5, TypeScript 6, Tailwind 4, ESLint 10, Prettier 3,
      Playwright, `@axe-core/playwright`, `vitest-browser-svelte`, `@sveltejs/package`).
- [ ] **Step 2: Copy configs.** `.prettierrc` from data-dashboard verbatim; `eslint.config.js`,
      `svelte.config.js`, `tsconfig.json` from monitor-map (drop the `$lib` path alias: map-sdk uses
      relative imports so `svelte-package` needs no rewriting); `.nvmrc` = `26`. `.env.example`
      lists `VITE_MAPTILER_KEY=` only.
- [ ] **Step 3: Write `tests/unit/package.test.ts`**: reads `package.json` and asserts
      `license === "MIT"`, every `exports` subpath has `svelte`, `types`, `default`, and
      `peerDependencies` contains `@sjvair/sdk` and `svelte` and `dependencies` does not.
- [ ] **Step 4:** `npm install`, then `npm run test:unit` → PASS. `npm run lint` and
      `npm run check` → no errors.
- [ ] **Step 5: CI workflow** `.github/workflows/ci.yml` on push and pull_request: Node from
      `.nvmrc`, `npm ci`, `npm run lint`, `npm run check`, `npm test`, `npm run test:bundle`,
      `npm run test:licenses`, `npm run test:e2e` (scripts not yet defined may be added by later
      tasks; until then CI lists only existing ones, and each later task adds its line).
- [ ] **Step 6: Commit** `git commit -m "Scaffold the package, tooling, and CI"`

### Task 2: References and data-source types

**Files:**

- Create: `src/lib/data/types.ts`, `src/lib/data/refs.ts`, `src/lib/data/static-source.ts`
- Test: `tests/unit/data/refs.test.ts`, `tests/unit/data/static-source.test.ts`

**Interfaces:**

- Produces:

  ```ts
  type FeatureRef =
  	| { kind: "monitor"; id: string }
  	| { kind: "region"; type: string; code: string }
  	| { kind: "feature"; id: string }; // not selectable (smoke polygons, fires)
  type SpatialSelection = { kind: "monitors" | "regions"; ids: string[] }; // dashboard shape
  type SelectionMode = "none" | "single" | "multiple";
  interface MapFeatureProperties {
  	refKey: string;
  	name: string;
  	value: number | string | null;
  }
  type DataStatus =
  	| { state: "loading" }
  	| { state: "ready" }
  	| { state: "error"; error: unknown; retry(): void }
  	| { state: "unavailable"; reason: string };
  interface DataSource<P extends MapFeatureProperties = MapFeatureProperties> {
  	readonly status: DataStatus;
  	readonly features: FeatureCollection<Geometry, P> | null;
  	readonly scale: ScaleRef | Scale | null;
  }
  function encodeRef(ref: FeatureRef): string; // "monitor:<id>", "region:<type>:<code>", "feature:<id>"
  function decodeRef(key: string): FeatureRef | null;
  function selectionId(ref: FeatureRef): string | null; // monitor id, or "type:code"; null for "feature"
  function toPlaceRef(
  	ref: FeatureRef
  ): { kind: "monitor"; id: string } | { kind: "region"; type: string; code: string } | null;
  function fromPlaceRef(place: { kind: string; [k: string]: unknown }): FeatureRef | null;
  function staticSource<P extends MapFeatureProperties>(
  	features: FeatureCollection<Geometry, P>,
  	scale: ScaleRef | Scale | null
  ): DataSource<P>;
  ```

- [ ] **Step 1: Write failing tests.** `refs.test.ts`: round-trips for all three kinds,
      including a region code containing `:` (`"region:land_use:Fresno-x:1"` decodes `type`
      `land_use`, `code` `Fresno-x:1`: split on the first two colons only); `decodeRef("bogus")`
      and `decodeRef("monitor:")` return `null`; `selectionId({ kind: "region", type: "county",
code: "06019" })` is `"county:06019"`; `toPlaceRef` of a `feature` ref is `null`;
      `fromPlaceRef({ kind: "point", lat: 1, lon: 2 })` is `null`. `static-source.test.ts`:
      `staticSource(fc, null).status` is `{ state: "ready" }` and `features` is the same object.
- [ ] **Step 2:** `npm run test:unit -- tests/unit/data` → FAIL (modules missing).
- [ ] **Step 3: Implement** the types and functions above (types import `Scale`/`ScaleRef` from
      `./scale-types.js`, created in Task 3; create that file now with the types only).
- [ ] **Step 4:** tests PASS.
- [ ] **Step 5: Commit** `"Add feature references and data-source types"`

### Task 3: Scales

**Files:**

- Create/complete: `src/lib/data/scale-types.ts`, `src/lib/data/scale.ts`
- Test: `tests/unit/data/scale.test.ts`, fixtures `tests/fixtures/scales.ts`

**Interfaces:**

- Produces:
  ```ts
  // Mirrors the server shape in sjvair.com docs/superpowers/specs/2026-11-03-metadata-scales-design.md.
  interface Level {
  	key: string;
  	label: string;
  	color: string;
  	opacity: number | null;
  	tier: number | null;
  	description: string;
  	guidance: string;
  	min?: number;
  	max?: number | null; // range scales; half-open [min, max), top max null
  	value?: string | number; // category scales
  }
  interface Scale {
  	id: string;
  	label: string;
  	units: string;
  	kind: "range" | "category";
  	levels: Level[];
  	source?: { name: string; url: string };
  }
  interface ScaleRef {
  	dataset: string;
  	entryType: string;
  }
  const NO_LEVEL: unique symbol;
  function levelFor(
  	value: number | string | null | undefined,
  	scale: Scale
  ): Level | typeof NO_LEVEL;
  function scaleFromLegacyLevels(
  	id: string,
  	label: string,
  	units: string,
  	levels: Array<{
  		name: string;
  		label: string;
  		color: string;
  		range: [number, number];
  		guidance: string | null;
  	}>
  ): Scale;
  ```
- Fixtures (`tests/fixtures/scales.ts`): `pm25Scale` (6 levels Good…Hazardous, tiers
  0,1,2,3,4,4, colors from the current monitors meta), `smokeScale` (`smoke-density`, category,
  light `#bfc8c3` 0.2, medium `#757b78` 0.3, heavy `#333634` 0.4, tiers 1,2,3), `fireScale`
  (`fire-frp`, range `<10, 10–49, 50–149, 150–349, ≥350` MW, colors `#FFD700 #FF8C00 #FF4500
#DC143C #8B0000`, tier null), `heatScale` (`heat-score`, category 0–4, colors `#DEDEDE #fae0c8
#ea8753 #c23a00 #700006`), `burnScale` (`burn-status`, category with one level whose `color`
  is `""`). Fixtures are test data, not shipped.

- [ ] **Step 1: Write failing tests:**
      `levelFor(0, pm25Scale).key === "good"`; the value equal to a level's `max` belongs to the next
      level; `levelFor(1000, pm25Scale)` is the top level (null `max`); `levelFor(-1, pm25Scale)`,
      `levelFor(null, …)`, `levelFor(NaN, …)`, `levelFor("abc", pm25Scale)` all `NO_LEVEL`;
      category: `levelFor("heavy", smokeScale).opacity === 0.4`, `levelFor("unknown", smokeScale)`
      is `NO_LEVEL`, a numeric category value `2` matches `heatScale` level with `value: 2`;
      `scaleFromLegacyLevels` turns old `{ range: [0, 9] }, { range: [9.1, 35.4] }, …` into
      half-open levels where each `max` is the next level's `range[0]` and the last `max` is `null`,
      `key` from `name` lowercased, `tier`/`opacity` null.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `levelFor` coerces numeric strings with `Number()` only for range
      scales; non-finite → `NO_LEVEL`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add scale types and level lookup"`

### Task 4: Selection rules

**Files:**

- Create: `src/lib/data/selection.ts`
- Test: `tests/unit/data/selection.test.ts`

**Interfaces:**

- Consumes: `FeatureRef`, `SpatialSelection`, `SelectionMode`, `selectionId` (Task 2).
- Produces:

  ```ts
  interface PickGesture {
  	additive: boolean;
  } // shift/⌘/Ctrl, or touch in multiple mode (decided by MapView)
  function applyPick(
  	current: SpatialSelection | null,
  	ref: FeatureRef,
  	mode: SelectionMode,
  	gesture: PickGesture
  ): SpatialSelection | null;
  function selectionKeys(sel: SpatialSelection | null): Set<string>; // refKeys ("monitor:x", "region:t:c")
  function selectionKind(ref: FeatureRef): "monitors" | "regions" | null;
  ```

- [ ] **Step 1: Write failing tests:** mode `none` returns `current` unchanged (same object);
      a `feature` ref returns `current` unchanged in every mode; `single` replaces (`{ kind:
"monitors", ids: ["b"] }` after picking `b` over `["a"]`), even when additive; `multiple`
      non-additive replaces with just the picked id; `multiple` additive toggles (adds `b` to
      `["a"]` → `["a","b"]`, preserving order; removing the last id returns `null`); picking a
      region while the selection holds monitors replaces it with a regions selection; ids the
      current selection holds that aren't in any data are never removed by picking another id
      (`["ghost","a"]` + additive `b` → `["ghost","a","b"]`); `selectionKeys` maps region
      `"county:06019"` to `"region:county:06019"`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add selection rules"`

### Task 5: Message and format providers

**Files:**

- Create: `src/lib/data/messages/en.json`, `src/lib/data/messages.ts`, `src/lib/data/format.ts`
- Test: `tests/unit/data/messages.test.ts`, `tests/unit/data/format.test.ts`

**Interfaces:**

- Produces:
  ```ts
  type MessageKey = keyof typeof en; // all keys start with "mapsdk_"
  type MessageParams = Record<string, string | number>;
  type MessageProvider = (key: MessageKey, params?: MessageParams) => string;
  const defaultMessages: MessageProvider;
  interface FormatProvider {
  	number(value: number, options?: Intl.NumberFormatOptions): string;
  	dateTime(value: Date | string): string; // Pacific
  	zoneLabel(): string | null; // "PT" only when the device zone isn't Pacific
  }
  function createDefaultFormat(deviceZone?: string): FormatProvider; // deviceZone defaults to Intl's resolved zone
  ```
- Catalog format: inlang message format JSON (`{"$schema": "https://inlang.com/schema/inlang-message-format", "mapsdk_list_button": "List", …}`) so the dashboard can add the file to its Paraglide project. Plurals: a message whose count varies has `_one` and `_other` keys (`mapsdk_selected_count_one: "{count} selected"`); `defaultMessages` picks the variant with `Intl.PluralRules("en-US")` when called with the base key and a numeric `count`.
- Keys needed by later tasks (add all now): `mapsdk_list_button`, `mapsdk_list_label`
  (`"Features on the map"`), `mapsdk_list_sort_name`, `mapsdk_list_sort_value`,
  `mapsdk_list_row` (`"{name}, {value} {units}, {level}"`), `mapsdk_list_row_no_value`
  (`"{name}, no reading"`), `mapsdk_list_selected` (`"selected"`), `mapsdk_list_empty`
  (`"Nothing on the map in this view"`), `mapsdk_selected_count_one/_other`,
  `mapsdk_selection_clear` (`"Clear"`), `mapsdk_summary_one/_other`
  (`"{count} {layer}"`), `mapsdk_summary_level` (`"{count} {level}"`), and
  `mapsdk_summary_with_levels` (`"{layer}: {levels}"`, where `{levels}` is an `Intl.ListFormat`
  list of `mapsdk_summary_level` items, so no sentence is concatenated), `mapsdk_no_level`
  (`"No level"`),
  `mapsdk_zoom_in`, `mapsdk_zoom_out`, `mapsdk_map_label` (`"Map. Use arrow keys to pan, plus
and minus to zoom."`), `mapsdk_unavailable` (`"{layer} isn't available right now"`),
  `mapsdk_loading`, `mapsdk_error_retry` (`"Try again"`), `mapsdk_cluster_tooltip`
  (`"{count} monitors, average {value} {units}"`), `mapsdk_legend_label` (`"Legend"`).

- [ ] **Step 1: Write failing tests:** every key in `en.json` (except `$schema`) starts with
      `mapsdk_`; `defaultMessages("mapsdk_list_row", { name: "A", value: "38", units: "µg/m³",
level: "Moderate" })` is `"A, 38 µg/m³, Moderate"`; `defaultMessages("mapsdk_selected_count",
{ count: 1 })` is `"1 selected"` and `{ count: 3 }` is `"3 selected"`; a missing param leaves
      the `{name}` text in place (no throw). Format: with `TZ`-independent input
      `"2026-07-01T19:30:00Z"`, `dateTime` shows `12:30 PM` Pacific (PDT); a January instant shows
      PST; `createDefaultFormat("America/Los_Angeles").zoneLabel()` is `null` and
      `createDefaultFormat("America/New_York").zoneLabel()` is `"PT"`; `number(38.25, {
maximumFractionDigits: 1 })` is `"38.3"`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (`date-fns` not needed; `Intl.DateTimeFormat`
      with `timeZone: "America/Los_Angeles"`). **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add message and format providers with English and Pacific defaults"`

### Task 6: Default metadata provider

**Files:**

- Create: `src/lib/data/metadata.ts`
- Test: `tests/unit/data/metadata.test.ts` (mock `@sjvair/sdk` with `vi.mock`)

**Interfaces:**

- Consumes: `Scale`, `ScaleRef`, `scaleFromLegacyLevels` (Task 3).
- Produces:
  ```ts
  interface EntryTypeInfo {
  	label: string;
  	units: string;
  }
  interface MetadataProvider {
  	scale(ref: ScaleRef, signal?: AbortSignal): Promise<Scale | "unavailable">;
  	entryType(ref: ScaleRef, signal?: AbortSignal): Promise<EntryTypeInfo | "unavailable">;
  	monitorTypeLabel(type: string, signal?: AbortSignal): Promise<string | "unavailable">;
  	attribution(dataset: string, signal?: AbortSignal): Promise<string | "unavailable">;
  }
  function createDefaultMetadata(): MetadataProvider;
  ```
- Behavior: each underlying fetch is memoized per provider instance, shared by concurrent
  callers, carries no caller signal, and is forgotten on failure (copy the `memoize` and
  `untilAborted` pattern from data-dashboard `src/lib/data/metadata.ts`). Never rejects except
  with an `AbortError` when the caller's signal aborts. Dataset routing: `air-quality` →
  `getMonitorsMeta()`; the entry type's new `scale` field if present, else
  `scaleFromLegacyLevels` from its `levels`; `label` and `units` from the entry meta. Every
  other dataset (`hms`, `calheatscore`, `forecasts`) → `"unavailable"` until Task 25 wires the
  new metas. `attribution` reads the catalog entry's `source` (via `getDatasetCatalog`), empty →
  `"unavailable"`. `monitorTypeLabel` reads the monitors meta's monitor types.

- [ ] **Step 1: Write failing tests:** two concurrent `scale({ dataset: "air-quality",
entryType: "pm25" })` calls make one `getMonitorsMeta` call; a rejected fetch gives
      `"unavailable"` and the next call fetches again; an aborted caller signal rejects with
      `name === "AbortError"` while another caller still resolves; legacy `levels` produce a range
      scale; a meta with `scale` uses it unchanged; unknown entry type → `"unavailable"`;
      `scale({ dataset: "hms", entryType: "smoke-density" })` → `"unavailable"`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the default metadata provider"`

### Task 7: The `/data` entry and the bundle and license checks

**Files:**

- Create: `src/lib/data/index.ts`, `src/lib/stores/index.ts` (exports nothing yet but a type),
  `scripts/check-bundle.mjs`, `scripts/check-licenses.mjs`
- Modify: `package.json` scripts `test:bundle` (`npm run build && node scripts/check-bundle.mjs`),
  `test:licenses`; `.github/workflows/ci.yml`

**Interfaces:**

- Produces: `@sjvair/map-sdk/data` re-exports everything from Tasks 2–6.
- `check-bundle.mjs`: adapted from monitor-map `tests/bundle/check-bundle.mjs`: bundles
  `./stores` and `./data` from `dist/` with Vite and fails if any eagerly loaded chunk matches
  `/maplibre|maptiler/i`, or if an `exports` target file is missing.
- `check-licenses.mjs`: walks `npm ls --omit=dev --all --json`, reads each package's `license`,
  fails on anything outside `MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC, MPL-2.0, 0BSD`,
  with a named exception for `@jsr/sjvair__sdk` (first-party MIT, JSR build has no field), the
  same exception the dashboard documents.

- [ ] **Step 1:** write the scripts and entries; add a deliberate temporary
      `import "@maptiler/sdk"` to `src/lib/data/index.ts`, run `npm run test:bundle` → FAIL naming
      `./data`. Remove it.
- [ ] **Step 2:** `npm run test:bundle` → PASS; `npm run test:licenses` → PASS.
- [ ] **Step 3:** add both to CI.
- [ ] **Step 4: Commit** `"Add the /data entry and bundle and license checks"`

### Task 8: The GL interface, a fake map, and the plugin host

**Files:**

- Create: `src/lib/core/gl.ts`, `src/lib/core/plugin.ts`, `src/lib/core/plugin-host.svelte.ts`
- Test: `tests/client/core/plugin-host.test.ts`, `tests/fixtures/fake-gl.ts`

**Interfaces:**

- Produces:
  ```ts
  // gl.ts: the subset of MapLibre's Map the core and plugins use (types only, `import type`).
  interface GlMapLike {
  	addSource(id: string, source: SourceSpecification): void;
  	removeSource(id: string): void;
  	getSource(id: string): unknown;
  	addLayer(layer: LayerSpecification, beforeId?: string): void;
  	removeLayer(id: string): void;
  	getLayer(id: string): unknown;
  	addImage(
  		id: string,
  		image: HTMLImageElement | ImageData,
  		options?: { pixelRatio?: number }
  	): void;
  	hasImage(id: string): boolean;
  	removeImage(id: string): void;
  	setFeatureState(
  		target: { source: string; id: string | number },
  		state: Record<string, unknown>
  	): void;
  	removeFeatureState(target: { source: string; id?: string | number }, key?: string): void;
  	queryRenderedFeatures(
  		point: [number, number] | [[number, number], [number, number]],
  		options?: { layers?: string[] }
  	): Array<{
  		layer: { id: string };
  		source: string;
  		id?: string | number;
  		properties: Record<string, unknown>;
  		geometry: Geometry;
  	}>;
  	isStyleLoaded(): boolean | void;
  	setStyle(style: unknown): void;
  	on(type: string, listener: (e: any) => void): void;
  	on(type: string, layerId: string, listener: (e: any) => void): void;
  	off(type: string, listener: (e: any) => void): void;
  	off(type: string, layerId: string, listener: (e: any) => void): void;
  	getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  	getCenter(): { lng: number; lat: number };
  	getZoom(): number;
  	getBearing(): number;
  	getPitch(): number;
  	easeTo(options: { center?: [number, number]; zoom?: number; duration?: number }): void;
  	jumpTo(options: {
  		center?: [number, number];
  		zoom?: number;
  		bearing?: number;
  		pitch?: number;
  	}): void;
  	getCanvas(): HTMLCanvasElement;
  	remove(): void;
  }
  // plugin.ts
  interface FeatureHit {
  	pluginId: string;
  	ref: FeatureRef;
  	refKey: string;
  	name: string;
  }
  interface FeatureListItem {
  	refKey: string;
  	ref: FeatureRef;
  	name: string;
  	value: number | string | null;
  	level: Level | typeof NO_LEVEL;
  	units: string;
  	lngLat: [number, number];
  	selectable: boolean;
  }
  type LegendData =
  	| { pluginId: string; title: string; units: string; scale: Scale }
  	| { pluginId: string; status: DataStatus };
  interface ClickEvent {
  	hits: FeatureHit[];
  	additive: boolean;
  	lngLat: [number, number];
  }
  interface PluginContext {
  	readonly gl: GlMapLike;
  	id(local: string): string; // `${mapUid}:${pluginId}:${local}`
  	readonly metadata: MetadataProvider;
  	readonly messages: MessageProvider;
  	readonly format: FormatProvider;
  	addSource(local: string, spec: SourceSpecification): string; // returns the namespaced id; auto-removed
  	addLayer(local: string, spec: Omit<LayerSpecification, "id">): string; // auto-removed (layers before sources)
  	addImage(id: string, image: HTMLImageElement | ImageData): void; // auto-removed; ids namespaced too
  	interactive(
  		layerIds: string[],
  		toHit: (props: Record<string, unknown>) => FeatureHit | null
  	): void; // click, hover, tooltip, featuresAt
  	readonly selectedKeys: ReadonlySet<string>; // reactive
  	effect(fn: () => void | (() => void)): void; // an $effect.root torn down with the plugin
  }
  interface MapPlugin {
  	id: string;
  	setup(ctx: PluginContext): () => void;
  	legend?(): LegendData | null;
  	features?(): FeatureListItem[];
  	selectable?: boolean;
  	displayOptions?: Snippet;
  }
  // plugin-host.svelte.ts
  class PluginHost {
  	constructor(opts: {
  		mapUid: string;
  		providers: Providers;
  		router: InteractionRouter;
  		selectedKeys(pluginId: string): ReadonlySet<string>;
  	});
  	add(plugin: MapPlugin): void;
  	remove(id: string): void;
  	readonly plugins: readonly MapPlugin[]; // ordered, reactive
  	attach(gl: GlMapLike): void; // runs setup for all plugins once the style is loaded
  	restyle(): void; // teardown + setup for all (after a basemap change)
  	detach(): void; // teardown all; gl is not touched after this
  }
  ```
- `tests/fixtures/fake-gl.ts`: `createFakeGl()` implementing `GlMapLike` in memory (sources,
  layers, images, feature states, listeners, a `styleLoaded` flag, `emit(type, e)`,
  `fireStyleLoad()`), with `queryRenderedFeatures` returning features registered by the test.

- [ ] **Step 1: Write failing tests** (client project so `$effect.root` runs):
  - `attach` on a fake whose style isn't loaded runs no `setup` until `fireStyleLoad()`;
  - every source, layer, and image a plugin adds is gone after `detach()`, layers before
    sources; ids are prefixed with the map uid and plugin id;
  - `detach()` while the style is still loading, then `attach(newGl)` and `fireStyleLoad()` on
    the new one: setup runs once on the new map and never on the old (Review Focus 2);
  - `restyle()` runs teardown then setup for each plugin in order;
  - `remove(id)` tears down only that plugin; adding a plugin with a duplicate id throws;
  - a plugin `effect` stops running after teardown;
  - a plugin whose `setup` throws is torn down, the others still run, and the error is passed
    to `console.error` with the plugin id (no crash).
- [ ] **Step 2:** run `npm run test:client -- tests/client/core` → FAIL.
- [ ] **Step 3: Implement.** The host tracks every resource through the `PluginContext` it
      hands out, so teardown doesn't depend on the plugin's own cleanup.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the plugin host with automatic cleanup"`

### Task 9: `createMap` and `MapContext`

**Files:**

- Create: `src/lib/core/create-map.svelte.ts`, `src/lib/core/context.ts`
- Test: `tests/client/core/create-map.test.ts`

**Interfaces:**

- Consumes: `PluginHost` (Task 8), `InteractionRouter` (Task 10; create its file with the
  constructor and a no-op body here and fill it in Task 10), `BasemapState` (Task 11; same),
  providers (Tasks 5–6), selection (Task 4).
- Produces:
  ```ts
  interface MapConfig {
  	maptilerKey: string;
  	basemaps?: BasemapConfig;
  	initialView?: CameraState;
  	cooperativeGestures?: boolean;
  }
  interface CameraState {
  	center: [number, number];
  	zoom: number;
  	bearing: number;
  	pitch: number;
  }
  interface CreateMapOptions {
  	config: MapConfig;
  	metadata?: MetadataProvider;
  	messages?: MessageProvider;
  	format?: FormatProvider;
  }
  interface PluginOptions {
  	selectionMode?: SelectionMode;
  	selection?: SpatialSelection | null;
  	onselectionchange?(sel: SpatialSelection | null): void;
  }
  interface MapContext {
  	readonly uid: string;
  	readonly config: Readonly<MapConfig>;
  	readonly metadata: MetadataProvider;
  	readonly messages: MessageProvider;
  	readonly format: FormatProvider;
  	readonly camera: CameraState; // reactive; updated by MapView on moveend
  	readonly basemap: BasemapState;
  	readonly plugins: readonly MapPlugin[];
  	readonly attached: boolean;
  	addPlugin(plugin: MapPlugin, options?: PluginOptions): void;
  	removePlugin(id: string): void;
  	setSelection(pluginId: string, selection: SpatialSelection | null): void; // host → map; does not call onselectionchange
  	getSelection(pluginId: string): SpatialSelection | null;
  	setSelectionMode(pluginId: string, mode: SelectionMode): void;
  	on(
  		event: "featureclick",
  		handler: (e: { pluginId: string; ref: FeatureRef }) => void
  	): () => void;
  	featuresAt(point: { x: number; y: number }): FeatureHit[];
  	featureForElement(element: Element): FeatureHit | null;
  	focusFeature(refKey: string): void; // pan to it (no animation under reduced motion) and mark it focused
  	readonly focusedKey: string | null;
  	attach(gl: GlMapLike): void;
  	detach(): void; // used by MapView only
  	destroy(): void;
  }
  function createMap(options: CreateMapOptions): MapContext;
  function setMapContext(ctx: MapContext): void;
  function getMapContext(): MapContext;
  ```
- Defaults: `initialView` = monitor-map's current start view (read it from monitor-map
  `src/lib/map/map-manager.svelte.ts` `initializeMap` and copy the numbers), `cooperativeGestures`
  `false`, providers default to `createDefaultMetadata()`, `defaultMessages`,
  `createDefaultFormat()`. `uid` is `crypto.randomUUID().slice(0, 8)` (no module-level
  counter).

- [ ] **Step 1: Write failing tests:**
  - two contexts get different `uid`s; a plugin added to one isn't in the other; selecting in
    one leaves the other's `getSelection` null (Review Focus 1);
  - `setSelection` then `detach()` then `attach(newFake)`: `getSelection` and `camera` survive,
    and plugins are set up again on the new map;
  - `setSelection` with ids not in any data keeps them (Review Focus 4);
  - `destroy()` detaches, clears plugins, and later `addPlugin` throws `"map destroyed"`;
  - after `destroy()`, `on` handlers are dropped.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add createMap and MapContext"`

### Task 10: Interaction routing, picking, and lookups

**Files:**

- Complete: `src/lib/core/interactions.ts`
- Modify: `src/lib/core/create-map.svelte.ts` (wire picks to selection and events)
- Test: `tests/client/core/interactions.test.ts`

**Interfaces:**

- Produces:
  ```ts
  class InteractionRouter {
  	register(
  		pluginId: string,
  		layerIds: string[],
  		toHit: (props: Record<string, unknown>) => FeatureHit | null
  	): () => void;
  	attach(gl: GlMapLike): void;
  	detach(): void;
  	hitsAt(point: [number, number]): FeatureHit[]; // topmost first, de-duplicated by refKey
  	onPick(handler: (e: ClickEvent) => void): () => void;
  	readonly hovered: { hit: FeatureHit; lngLat: [number, number] } | null; // reactive, for the tooltip
  }
  ```
- Picking: a click with hits → `featureclick` for the top hit, then
  `applyPick(selection, hit.ref, mode, { additive })` for that hit's plugin; if the result
  differs, store it and call that plugin's `onselectionchange`. `additive` = `shiftKey ||
metaKey || ctrlKey`, or `pointerType === "touch"` when the plugin's mode is `multiple`.
  A click with no hits does nothing. Cluster hits (Task 20) zoom instead and are never picked.
- `featureForElement(el)`: walks up to the nearest `[data-mapsdk-ref]` element (set by the
  feature list, Task 18) inside this map's container and returns its hit; elements from another
  map's list return `null`.

- [ ] **Step 1: Write failing tests** against the fake GL with registered rendered features:
      click → `featureclick` fires with the ref; `multiple` + shift toggles; `multiple` + touch
      toggles; `single` + shift replaces; empty click leaves the selection; `featuresAt` returns
      hits from two plugins topmost first; `featureForElement` resolves a `data-mapsdk-ref`
      element and returns `null` for one under another map's root; `hovered` is set on
      `mousemove` over a registered layer and cleared on `mouseleave`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Route clicks and hovers to selection and events"`

### Task 11: Basemap switching with fallback

**Files:**

- Complete: `src/lib/core/basemap.svelte.ts`
- Test: `tests/client/core/basemap.test.ts`

**Interfaces:**

- Produces:
  ```ts
  interface BasemapConfig {
  	styles: Array<{ id: string; style: unknown }>;
  	defaultId: string;
  	excludedLayers?: string[];
  }
  class BasemapState {
  	readonly current: string; // reactive id
  	select(id: string): void;
  	attach(gl: GlMapLike, onStyleReady: () => void): void;
  	detach(): void;
  }
  ```
- Port monitor-map's `map-style-state.svelte.ts` logic: supersede an in-flight change; on a
  style-document error go back to the last loaded style and revert `current`; if that fails too,
  stay unstyled until the next `select`. After each successful load, remove `excludedLayers`
  and call `onStyleReady` (which runs `PluginHost.restyle()`). The default `BasemapConfig` is
  built in `create-gl-map.ts` (Task 12) from `MapStyle.STREETS_V4` variants with
  `excludedLayers` `["Sport", "Tourism", "Culture", "Shopping", "Food", "Transport"]`, so this
  file needs no runtime MapTiler import.

- [ ] **Step 1: Write failing tests:** `select` calls `setStyle` once; a second `select` before
      `style.load` supersedes the first (only the second's load triggers `onStyleReady`); a style
      error for the requested URL reverts `current` and reloads the last good style; an error event
      for a tile URL is ignored; excluded layers are removed on load.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add basemap switching with fallback"`

### Task 12: `MapView`

**Files:**

- Create: `src/lib/view/create-gl-map.ts`, `src/lib/view/MapView.svelte`, `src/lib/ui/theme.css`
- Modify: `src/lib/index.ts`
- Test: `tests/browser/map-view.browser.test.ts` (MapTiler style replaced by an inline empty
  style `{ version: 8, sources: {}, layers: [] }` passed through `config.basemaps`, so no
  network or key is needed)

**Interfaces:**

- Produces:
  ```svelte
  <MapView map={MapContext} active?={boolean} class?={string} label?={string}
           overlays?={Snippet} />  <!-- renders controls, legend, list button, selection bar, summary (Tasks 16–19) -->
  ```
  `createGlMap(container: HTMLElement, ctx: MapContext): GlMapLike` sets the MapTiler key
  from `ctx.config` on the map instance (never the global `config.apiKey`), passes
  `cooperativeGestures`, `keyboard: true`, the camera from `ctx.camera`, `attributionControl:
false`, `navigationControl: false` (Task 19 draws its own), and listens for `moveend` to
  update `ctx.camera`.
- Behavior: when `active` is true and mounted, create the GL map and `ctx.attach(gl)`; when
  `active` becomes false or on unmount, `ctx.detach()` then `gl.remove()`. The container is
  `role="region"` (not `application`) with `aria-label` from `label` or `mapsdk_map_label`;
  MapLibre's canvas keeps its own `tabindex` as the map's single tab stop.
  `setMapContext(ctx)` for children.

- [ ] **Step 1: Write failing browser tests:** two `MapView`s with two contexts on one page each
      get their own canvas; toggling `active` false removes the canvas and true brings it back with
      the same camera (move the camera between, assert it's restored); unmounting calls
      `ctx.detach()` (spy); the region has an accessible name.
- [ ] **Step 2:** `npm run test:browser` → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add MapView with WebGL release and rebuild"`

### Task 13: Scale to map style expressions

**Files:**

- Create: `src/lib/plugins/style.ts`
- Test: `tests/unit/plugins/style.test.ts`

**Interfaces:**

- Produces:
  ```ts
  function colorExpression(
  	scale: Scale,
  	property: "value",
  	neutral: string
  ): ExpressionSpecification; // "step" for range, "match" for category
  function opacityExpression(
  	scale: Scale,
  	property: "value",
  	fallback: number
  ): ExpressionSpecification | number;
  function levelKeyExpression(scale: Scale, property: "value"): ExpressionSpecification; // for filters and icon ids
  const NEUTRAL_COLOR_VAR = "--muted"; // resolved at setup via getComputedStyle on the container; never a literal hex
  ```
- Null/non-numeric values and empty level colors map to `neutral` (Review Focus 3). The
  `neutral` string is read from the host's `--muted` token at setup time.

- [ ] **Step 1: Write failing tests:** `colorExpression(pm25Scale, …)` is a `step` over
      `["to-number", ["get", "value"], -1]` whose breakpoints equal each level's `min` and whose
      below-first output is `neutral`; for `smokeScale` a `match` with the three keys and `neutral`
      default; for `burnScale` the empty-color level outputs `neutral`; `opacityExpression(
smokeScale, …, 0.6)` matches 0.2/0.3/0.4 and defaults 0.6; for `pm25Scale` (all null
      opacities) it returns the number `fallback`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Turn scales into map style expressions"`

### Task 14: `pointsPlugin`

**Files:**

- Create: `src/lib/plugins/points.svelte.ts`, `src/lib/plugins/icons.ts`
- Test: `tests/client/plugins/points.test.ts`

**Interfaces:**

- Consumes: `PluginContext` (Task 8), `DataSource` (Task 2), style (Task 13), `levelFor` (Task 3).
- Produces:
  ```ts
  interface PointsOptions<P extends MapFeatureProperties> {
  	id: string;
  	source: DataSource<P>;
  	layerLabel: string; // already-translated layer name for list and summary
  	selectable?: boolean;
  	icon?: {
  		category(props: P): string;
  		draw(category: string, color: string): string /* SVG */;
  		size: number;
  	};
  	circle?: { radius: number }; // when no icon
  	cluster?: { radius: number; maxZoom: number; groupBy?(props: P): string }; // one clustered source per group
  	sortKey?(props: P): number; // higher draws on top
  	listed?: boolean; // default true
  }
  function pointsPlugin<P extends MapFeatureProperties>(options: PointsOptions<P>): MapPlugin;
  // icons.ts (ported from monitor-map src/lib/map/icons.ts): circle, square, triangle, fireIcon, asDataURI, plus
  function selectedOverlay(): string; // ring + check mark SVG, colored from the --highlight token at setup
  ```
- Behavior: resolve the scale (a `ScaleRef` through `ctx.metadata.scale`, or a `Scale`
  as-is); while unresolved or `"unavailable"`, add no layers and report `legend()` as a status.
  Re-render with `source.setData` (no layer churn) whenever `source.features` changes.
  Selected features: feature-state `selected: true` drives a second symbol layer with the
  `selectedOverlay` image above the icon. `features()` returns one `FeatureListItem` per
  feature with `level = levelFor(value, scale)`. Icons per (category, level color) generated
  once per setup and namespaced.

- [ ] **Step 1: Write failing tests** (fake GL): with a `ScaleRef` resolving to
      `"unavailable"`, no layers and `legend()` is `{ status: { state: "unavailable", … } }`; with
      `pm25Scale`, layers exist and the color expression comes from Task 13; updating
      `source.features` calls `setData` on the same source without re-adding layers; selected keys
      set feature-state `selected` and clear it when deselected; data replaced **while detached**
      shows the new features and current selection after `attach` (Review Focus 5); `features()`
      item for a null value has `level === NO_LEVEL`; `cluster.groupBy` creates one source per
      group.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the general points plugin"`

### Task 15: `shapesPlugin`

**Files:**

- Create: `src/lib/plugins/shapes.svelte.ts`
- Test: `tests/client/plugins/shapes.test.ts`

**Interfaces:**

- Produces:
  ```ts
  interface ShapesOptions<P extends MapFeatureProperties> {
  	id: string;
  	source: DataSource<P>;
  	layerLabel: string;
  	mode: "plain" | "choropleth";
  	selectable?: boolean;
  	listed?: boolean; // default true
  	fillOpacity?: number; // used when a level's opacity is null (default 0.6)
  }
  function shapesPlugin<P extends MapFeatureProperties>(options: ShapesOptions<P>): MapPlugin;
  ```
- Layers: a fill (color from `colorExpression` in `choropleth`, neutral in `plain`), an outline
  line, and a selected outline line (width 3, `--highlight` color) filtered by feature-state.
  `features()` uses each feature's label point (`@turf/helpers` not needed: compute the
  centroid of the largest polygon ring in a small local helper) for `lngLat`.

- [ ] **Step 1: Write failing tests:** choropleth with `smokeScale` uses the opacity expression;
      plain mode uses no scale and `legend()` returns `null`; selection sets the selected outline
      state; a MultiPolygon feature's `lngLat` lies inside its largest part.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the general shapes plugin"`

### Task 16: Legend

**Files:**

- Create: `src/lib/ui/legend-data.ts`, `src/lib/ui/Legend.svelte`, `src/lib/ui/LegendBar.svelte`
- Test: `tests/unit/ui/legend-data.test.ts`, `tests/browser/legend.browser.test.ts`

**Interfaces:**

- Produces:

  ```ts
  type LegendBar =
  	| { kind: "gradient"; stops: Array<{ color: string; label: string; tick: string }> }
  	| { kind: "blocks"; blocks: Array<{ color: string; opacity: number | null; label: string }> };
  interface LegendSection {
  	pluginId: string;
  	title: string;
  	units: string;
  	bar: LegendBar;
  }
  function legendSection(data: LegendData, format: FormatProvider): LegendSection | null; // null for status-only data
  function swatchOverBackground(color: string, opacity: number | null, background: string): string; // ported swatchOverWhite, background from the --background token
  ```

  `<Legend map={MapContext} />` renders one section per plugin with a legend, using monitor-map
  `src/lib/legend/Legend.svelte` and `LegendBar.svelte` as the visual reference. Range scales →
  gradient with a tick per level at `min` (formatted, `Math.floor` as today); category scales →
  blocks. Every color shows its label; every swatch has a 1px `--foreground`-mixed outline that
  meets 3:1; the legend region has `aria-label` `mapsdk_legend_label`.

- [ ] **Step 1: Write failing tests:** `legendSection` for `pm25Scale` → gradient with 6 stops
      and ticks `"0","9","35",…` (from fixture mins); for `smokeScale` → 3 blocks with opacities;
      browser: each label text is visible next to its swatch; axe on the rendered legend reports no
      violations.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the legend"`

### Task 17: Tooltip

**Files:**

- Create: `src/lib/ui/MapTooltip.svelte`
- Modify: `src/lib/view/MapView.svelte`
- Test: `tests/browser/tooltip.browser.test.ts`

**Interfaces:**

- Consumes: `InteractionRouter.hovered` (Task 10), `MapContext.focusedKey` (Task 9), plugin
  `features()` (Tasks 14–15).
- Produces: `<MapTooltip map={MapContext} />`, placed by `MapView`, shown for the hovered hit
  or the focused list item, positioned with the GL map's `project(lngLat)` (add `project` to
  `GlMapLike`). Content: name; value with units via `format.number`; level label on a chip whose
  background is the level color and whose text color is `readableColor(color)` (`color2k`);
  `NO_LEVEL` → `mapsdk_no_level` on a neutral chip. A plugin may supply `tooltip?(item):
Snippet` for richer content (the monitors preset uses it in Task 20); add that optional
  member to `MapPlugin`.

- [ ] **Step 1: Write failing tests:** focusing a list item (set `focusedKey`) shows its name,
      value, and level label; a yellow level (`#ffff00`) chip text is black; an empty-color level
      shows "No level" without throwing.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the map tooltip"`

### Task 18: Feature list

**Files:**

- Create: `src/lib/ui/feature-list.ts`, `src/lib/ui/FeatureList.svelte`
- Modify: `src/lib/view/MapView.svelte` (List button toggles the list panel)
- Test: `tests/unit/ui/feature-list.test.ts`, `tests/browser/feature-list.browser.test.ts`

**Interfaces:**

- Produces:

  ```ts
  type Bounds = { west: number; south: number; east: number; north: number };
  function inView(items: FeatureListItem[], bounds: Bounds): FeatureListItem[];
  function sortItems(items: FeatureListItem[], by: "name" | "value"): FeatureListItem[]; // value: desc, NO_LEVEL/null last; name: Intl.Collator("en-US")
  function typeaheadIndex(items: FeatureListItem[], query: string, from: number): number; // next name starting with query (case-insensitive), wrapping; -1 if none
  function rowLabel(
  	item: FeatureListItem,
  	messages: MessageProvider,
  	format: FormatProvider
  ): string; // mapsdk_list_row / mapsdk_list_row_no_value
  ```

  `<FeatureList map={MapContext} />`: a `role="listbox"` with `aria-label` `mapsdk_list_label`,
  `aria-multiselectable` when any listed plugin is in `multiple` mode, one tab stop, roving
  `aria-activedescendant`; rows `role="option"` with `aria-selected` and
  `data-mapsdk-ref={refKey}`. Keys: Up/Down/Home/End move; printable keys typeahead (500 ms
  buffer); Enter picks with `additive: false`; Space picks with `additive: true`; moving the
  active row calls `focusFeature`. Rows for non-selectable items aren't selectable but still
  focus and pan. Virtualized: only rows within the scroll viewport plus 10 above and below are
  in the DOM (fixed row height from a token-based class). The native `contextmenu` event on a
  row bubbles normally, so the host's menu scope sees it and calls `featureForElement`.
  Items come from every plugin's `features()` filtered by `inView(…, ctx.camera bounds)`,
  re-computed on `moveend` only.

- [ ] **Step 1: Write failing tests:** unit: `inView` keeps only items inside bounds (and handles
      a bounds crossing nothing special: no antimeridian support needed for the Valley; assert a
      point exactly on the edge is kept); `sortItems` by value puts nulls last; `typeaheadIndex`
      wraps; `rowLabel` for a null value uses `mapsdk_list_row_no_value`. Browser: with 5,000 items
      the DOM holds under 100 rows; Down then Space on a `multiple` plugin calls
      `onselectionchange` with the row's id added; Enter on a `single` plugin replaces; the row has
      `aria-selected="true"` afterwards; Shift+F10 on the focused row dispatches a `contextmenu`
      event whose target resolves through `ctx.featureForElement`; axe reports no violations.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the keyboard feature list"`

### Task 19: Selection bar, view summary, and controls

**Files:**

- Create: `src/lib/ui/view-summary.ts`, `src/lib/ui/ViewSummary.svelte`,
  `src/lib/ui/SelectionBar.svelte`, `src/lib/ui/MapControls.svelte`
- Modify: `src/lib/view/MapView.svelte`, `src/lib/index.ts` (export all UI components and data
  functions)
- Test: `tests/unit/ui/view-summary.test.ts`, `tests/browser/controls.browser.test.ts`

**Interfaces:**

- Produces:

  ```ts
  function summaryText(
  	layerLabel: string,
  	items: FeatureListItem[],
  	scale: Scale | null,
  	messages: MessageProvider
  ): string;
  ```

  Counts items per level in scale order, omits zero counts, builds `mapsdk_summary_level` items
  joined by `Intl.ListFormat("en-US", { type: "unit" })`, wrapped in
  `mapsdk_summary_with_levels`; with no scale, `mapsdk_summary` with the count only.
  `<ViewSummary>`: an `aria-live="polite"` region updated 750 ms after the last `moveend`
  (debounced), one line per listed plugin. `<SelectionBar>`: per plugin with a non-empty
  selection, `mapsdk_selected_count` (counting every id, including ids not in the data) and a
  Clear button that calls the plugin's `onselectionchange(null)`; the count change is announced
  in the same live region. `<MapControls>`: zoom in/out buttons (`mapsdk_zoom_in/out`, calling
  `easeTo` with `duration: 0` under `prefers-reduced-motion`) and an attribution line from
  `metadata.attribution(dataset)` for each plugin's dataset plus MapTiler/OSM credits.

- [ ] **Step 1: Write failing tests:** `summaryText("monitors", items, pm25Scale, …)` →
      `"monitors: 3 Unhealthy, 20 Moderate"`-style ordered by scale order (assert exact string from
      the fixture); a selection with 2 ids of which 1 is in the data shows "2 selected" (Review
      Focus 4); Clear calls `onselectionchange(null)`; zoom buttons have accessible names; under an
      emulated reduced-motion media query, zoom uses `duration: 0`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the selection bar, view summary, and controls"`

### Task 20: Monitors preset

**Files:**

- Create: `src/lib/presets/monitors.ts`, `src/lib/presets/MonitorTooltip.svelte`,
  `src/lib/presets/MonitorClusterTooltip.svelte`
- Test: `tests/client/presets/monitors.test.ts`, fixture `tests/fixtures/monitors.ts`

**Interfaces:**

- Consumes: `pointsPlugin` (Task 14).
- Produces:
  ```ts
  // In src/lib/data/types.ts (not presets/), so /stores can use it without reaching presets:
  interface MonitorFeatureProperties extends MapFeatureProperties {
  	type: string;
  	isActive: boolean;
  	isSjvair: boolean;
  	location: "inside" | "outside";
  }
  // In src/lib/presets/monitors.ts:
  interface MonitorsPluginOptions {
  	id?: string /* default "monitors" */;
  	source: DataSource<MonitorFeatureProperties>;
  	layerLabel: string;
  	selectable?: boolean;
  	clustered?: boolean; /* default true */
  }
  function monitorsPlugin(options: MonitorsPluginOptions): MapPlugin;
  function monitorShape(type: string): "circle" | "square" | "triangle"; // ported getTypeShape, presentation only
  ```
- Look parity with monitor-map 4.3.0 (open both in a browser to compare during Task 23):
  shape by type via `monitorShape`; level color fill; inactive and inside variants as in
  `monitors-icon-manager.svelte.ts`; draw order from `getOrder` (port it); clustering per
  monitor type with `cluster.groupBy = props.type`, radius 40, max zoom 9, and the cluster's
  average from `clusterProperties.sumValues`; clicking a cluster zooms in (never picks); hover
  tooltips ported from `MonitorTooltip.svelte` and `MonitorClusterTooltip.svelte` with
  message keys. No pollutant names, units, or colors in this file.

- [ ] **Step 1: Write failing tests:** `monitorShape("airnow") === "triangle"`,
      `monitorShape("purpleair") === "circle"`, unknown → `"circle"`; with three types the plugin
      adds three clustered sources; a cluster hit is not passed to `applyPick` (spy) and calls
      `easeTo`; inactive monitors use the inactive icon variant.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the monitors preset"`

### Task 21: Region fill, CalHeatScore ZIPs, and forecast zones presets

**Files:**

- Create: `src/lib/presets/regions.ts`, `src/lib/presets/calheatscore.ts`,
  `src/lib/presets/forecast-zones.ts`
- Test: `tests/client/presets/shapes-presets.test.ts`

**Interfaces:**

- Consumes: `shapesPlugin` (Task 15).
- Produces (each a thin `shapesPlugin` with `mode: "choropleth"`, `selectable: true` by default,
  and region refs):

  ```ts
  function regionsPlugin(o: {
  	id?: string /* "regions" */;
  	source: DataSource;
  	layerLabel: string;
  	selectable?: boolean;
  }): MapPlugin;
  function calHeatScorePlugin(o: {
  	id?: string /* "calheatscore" */;
  	source: DataSource;
  	layerLabel: string;
  	selectable?: boolean;
  }): MapPlugin;
  function forecastZonesPlugin(o: {
  	id?: string /* "forecast-zones" */;
  	source: DataSource;
  	layerLabel: string;
  	selectable?: boolean;
  }): MapPlugin;
  ```

  Each documents (TSDoc) the `ScaleRef` its source is expected to carry: regions
  `{ dataset: "air-quality", entryType: <pollutant> }`, CalHeatScore `{ dataset:
"calheatscore", entryType: "heat-score" }`, forecast zones `{ dataset: "forecasts",
entryType: "aqi-forecast" }`, and that feature `refKey`s are `region:<type>:<code>` (ZIPs use
  type `zipcode`, the server's region type name; confirm against `regions/meta/` when wiring the
  demo and fix here if it differs).

- [ ] **Step 1: Write failing tests:** each preset's `id` default; a pick on a ZIP feature
      yields `{ kind: "regions", ids: ["zipcode:93721"] }`; with `heatScale` the fill uses a
      `match` expression; with an `"unavailable"` scale the preset adds no layers.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add region fill, CalHeatScore, and forecast zone presets"`

### Task 22: HMS smoke and fire presets

**Files:**

- Create: `src/lib/presets/hms-smoke.ts`, `src/lib/presets/hms-fire.ts`,
  `src/lib/presets/fire-groups.ts`
- Test: `tests/unit/presets/fire-groups.test.ts`, `tests/client/presets/hms.test.ts`

**Interfaces:**

- Produces:

  ```ts
  function hmsSmokePlugin(o: {
  	id?: string /* "hms-smoke" */;
  	source: DataSource;
  	layerLabel: string;
  }): MapPlugin; // shapes, choropleth, selectable false, listed false
  function hmsFirePlugin(o: {
  	id?: string /* "hms-fire" */;
  	source: DataSource;
  	layerLabel: string;
  }): MapPlugin; // points with the fire icon, selectable false
  interface FireGroup {
  	id: string;
  	coordinates: [number, number];
  	avgFrp: number;
  	count: number;
  }
  function groupFires(
  	fires: Array<{ id: string; coordinates: [number, number]; frp: number }>
  ): FireGroup[]; // ported DBSCAN, epsilon 2 km, minPoints 1
  ```

  Fire icon color comes from the `fire-frp` level for the group's average FRP; icon size by
  level index `[20, 24, 28, 32, 36]` (presentation, as today). Smoke uses each level's
  `opacity` (0.2/0.3/0.4 from metadata) and `fillOpacity` default otherwise.

- [ ] **Step 1: Write failing tests:** `groupFires` merges two fires 1 km apart into one group
      with the mean coordinates and mean FRP, and keeps a fire 10 km away separate; smoke with
      `smokeScale` uses the opacity `match`; the fire plugin picks the icon of the right level for
      FRP 9.9 (first) and 10 (second); neither plugin is selectable; smoke has no list items.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `"Add the HMS smoke and fire presets"`

### Task 23: Demo page and end-to-end tests

**Files:**

- Create: `demo/index.html`, `demo/main.ts`, `demo/App.svelte`,
  `demo/date-range-source.svelte.ts`, `playwright.config.ts`, `e2e/demo.spec.ts`,
  `e2e/fixtures/*.json`
- Modify: `vite.config.ts` (dev server root `demo/`, `/api/` proxy to
  `http://localhost:8000`), `package.json` (`test:e2e`), CI

**Interfaces:**

- Consumes: everything above.
- `demo/date-range-source.svelte.ts`: `createDateRangeSource(kind: "monitors" | "regions" |
"calheatscore" | "forecast-zones" | "hms-smoke" | "hms-fire", range: { start: string; end:
string }, entryType?: string): DataSource` over `@sjvair/sdk` (monitor daily bulk summaries
  averaged over the range; region summaries; HMS by date; CalHeatScore and forecasts once their
  wrappers exist, else `unavailable`). Boundaries from the `regions/geojson/` wrapper when it
  exists; until then a plain `fetch("/api/2.0/regions/geojson/?type=…")` **in the demo only**.
- Page: two `MapView`s side by side. Left: date-range sources with a checkbox per preset, a
  date range input, a selection-mode select, a JSON textarea showing and editing the monitors
  selection (two-way), and a "Hide map" toggle bound to `active`. Right: placeholder text until
  Task 24, then a live `createMonitorsStore()` source. Both use the same providers' defaults.
  The page's `app.css` defines the shadcn tokens with a light and dark set
  (`prefers-color-scheme` and `[data-theme]`) and a theme switch, to exercise dark mode.
  `VITE_MAPTILER_KEY` read from `.env`.
- `e2e/demo.spec.ts` (Chromium, Firefox, WebKit) with `page.route("**/api/**")` serving
  `e2e/fixtures/*.json`: both maps render a canvas; picking a monitor via the list on the left
  map updates the textarea and leaves the right map unselected; editing the textarea selects on
  the map (the list row shows `aria-selected`); Hide then Show keeps the camera and selection;
  axe (`@axe-core/playwright`) reports no WCAG 2.2 AA violations in light and dark themes;
  keyboard only: Tab reaches the map, the List button, and the list, and Space selects.
  MapTiler requests are routed to a local empty style so CI needs no key.

- [ ] **Step 1:** write `e2e/demo.spec.ts` → FAIL (no demo).
- [ ] **Step 2:** build the demo and fixtures.
- [ ] **Step 3:** `npm run test:e2e` → PASS on all three engines. Add to CI.
- [ ] **Step 4: By hand against the local stack** (`npm run dev`, sjvair.com at
      `localhost:8000`, after `podman exec sjvaircom_web_1 python manage.py loaddata
default-calibrations.yaml`): monitors and region fill show real data; compare the monitors
      layer side by side with monitor-map 4.3.0 (`npm run dev` there) for shapes, colors,
      clusters, and tooltips; note any differences in the task report.
- [ ] **Step 5: Commit** `"Add the demo page and end-to-end tests"`

### Task 24: `createMonitorsStore()`

**Files:**

- Create: `src/lib/stores/abort.ts`, `src/lib/stores/monitors-store.svelte.ts`
- Modify: `src/lib/stores/index.ts`, `demo/App.svelte` (right map)
- Test: `tests/unit/stores/monitors-store.test.ts`, `tests/client/stores/monitors-store-refetch.test.ts`

**Interfaces:**

- Produces:
  ```ts
  interface MonitorsStoreOptions {
  	pollIntervalMs?: number /* default 120_000 */;
  	metadata?: MetadataProvider;
  }
  interface MonitorsStore {
  	readonly initialized: boolean;
  	readonly entryType: string | null;
  	readonly monitors: ReadonlyMap<string, MonitorsListItem>; // from getMonitorsList
  	readonly latest: ReadonlyMap<string, { value: number | null; timestamp: string }>;
  	readonly availableEntryTypes: readonly string[]; // from monitors meta available_pollutants
  	entryTypeFor(next: string): void; // set the entry type; refetches latest once initialized
  	init(
  		entryType?: string,
  		options?: { autoUpdate?: boolean; signal?: AbortSignal }
  	): Promise<void>;
  	update(options?: { signal?: AbortSignal }): Promise<void>;
  	pauseAutoUpdate(): void;
  	resumeAutoUpdate(): void;
  	readonly dataSource: DataSource<MonitorFeatureProperties>; // for monitorsPlugin; scale = { dataset: "air-quality", entryType }
  	dispose(): void;
  }
  function createMonitorsStore(options?: MonitorsStoreOptions): MonitorsStore;
  ```
  `MonitorFeatureProperties` comes from `src/lib/data/types.ts` (Task 20), so `/stores` never
  imports from `presets/`.
- Port the rules from monitor-map `src/lib/monitors/monitors.svelte.ts` and its CLAUDE.md
  "`monitorsManager.init()` rules" and "Cancelling requests" sections exactly, with entry types
  as strings instead of `"pm25" | "o3"`. Port its tests
  (`tests/monitors/monitors-manager.test.ts`, `tests/client/monitors-manager-refetch.test.ts`,
  the abort cases) as the starting test set, adapted to a factory (no module re-import needed).

- [ ] **Step 1: Write failing tests:** the ported set, plus: two stores are independent (an
      update on one doesn't touch the other); a store with no map reachable loads and polls
      (`autoUpdate` default true) and `init(…, { autoUpdate: false })` doesn't poll; `dispose()`
      stops polling and aborts in-flight requests; `dataSource.status` goes `loading` → `ready`, and
      `error` with a working `retry()`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS, and
      `npm run test:bundle` still PASS (`/stores` doesn't reach the map engine).
- [ ] **Step 5:** wire the demo's right map; check the live map by hand against the local stack.
- [ ] **Step 6: Commit** `"Add createMonitorsStore"`

### Task 25: Adopt the server's scale types and metas (when the sdk-js beta is out)

**Gate:** start only when the sjvair.com session reports an `@sjvair/sdk` beta with `Scale`,
`Level`, and the `hms/`, `calheatscore/`, `forecasts/` meta and `regions/geojson/` wrappers. If
it isn't out when Task 24 ends, stop and report; the user decides whether to wait.

**Files:**

- Modify: `package.json` (pin the beta), `src/lib/data/scale-types.ts` (re-export the SDK's
  types, keeping `ScaleRef` local), `src/lib/data/metadata.ts` (route `hms`, `calheatscore`,
  `forecasts` to the new metas), `demo/date-range-source.svelte.ts` (use the wrappers, drop the
  demo-only fetch)
- Test: `tests/unit/data/metadata.test.ts` (extend), `tests/unit/data/scale-types.test.ts`

- [ ] **Step 1: Write failing tests:** the fixtures in `tests/fixtures/scales.ts` type-check as
      the SDK's `Scale` (a `satisfies` assertion); `scale({ dataset: "hms", entryType:
"smoke-density" })` returns the meta's scale; the same for `fire-frp`, `heat-score`,
      `aqi-forecast`, `burn-status`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; `npm run check`
      clean.
- [ ] **Step 5:** by hand on the demo, against a local stack running the server's scales branch:
      all six presets show real data. This is milestone 1's "done" check.
- [ ] **Step 6: Commit** `"Use the server's shared scale types and metas"`

### Task 26: README, CLAUDE.md, and the release workflow

**Files:**

- Create: `README.md`, `CLAUDE.md`, `.github/workflows/release.yml`

- [ ] **Step 1: README:** install (npm, peers, the `@sjvair/sdk` alias line), the Tailwind
      `@source "../node_modules/@sjvair/map-sdk/dist";` line, importing `@sjvair/map-sdk/theme.css`,
      every token map-sdk reads with its fallback, a minimal `createMap` + `MapView` +
      `monitorsPlugin` example, data sources and `staticSource` for plain GeoJSON, selection (modes,
      `SpatialSelection`, `featuresAt`/`featureForElement` for context menus), providers and
      adding `messages/en.json` to a Paraglide project, the WebGL release (`active`), the demo
      page and the local-stack notes (proxy, `.env`, the `loaddata default-calibrations.yaml`
      step).
- [ ] **Step 2: CLAUDE.md** in monitor-map's style: commands, architecture overview (core,
      plugins, presets, UI, entries), test projects, code style, and the standing release
      restriction copied from monitor-map's CLAUDE.md (never publish, tag, or create a GitHub
      Release without the user's explicit yes, every time).
- [ ] **Step 3: `release.yml`**: on `release: published`, `npm ci`, the full test set, `npm run
build`, `npm publish --access public --provenance` with `NODE_AUTH_TOKEN`. Never run it.
- [ ] **Step 4:** `npm run lint && npm run check && npm test && npm run test:bundle &&
npm run test:licenses && npm run test:e2e` → all pass.
- [ ] **Step 5: Commit** `"Add the README, CLAUDE.md, and the release workflow"`
