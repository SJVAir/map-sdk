# map-sdk milestone 2 (monitor-map parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add what monitor-map 5.0 needs to look and work like monitor-map 4.3.0 on map-sdk, as general options any map can use.

**Architecture:** Additive changes to the existing core (`MapContext`, `PluginContext`, the interaction router), the general plugins (`pointsPlugin`, `shapesPlugin`), the presets, `MapView` and its UI, plus three new map-free stores and one new preset. Every new behavior is opt-in except the two monitor colors and the credits control. No module globals; ids stay namespaced.

**Tech Stack:** Svelte 5 runes, TypeScript, `@maptiler/sdk` ~4.2.0 (MapLibre 5), `@sjvair/sdk` 5.0.0-beta.2, Vitest (unit, client, browser projects), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-map-sdk-milestone-2-design.md` (approved 2026-11-04). Item numbers below ("spec 1", …) are its "What map-sdk adds" items. Milestone 1's spec and `CLAUDE.md` still bind.

## Global Constraints

- Branch from `origin/main` in a worktree; one PR into `main`; never merge, push tags, or publish without the user's yes.
- No Claude or AI attribution in commits, PRs, or docs.
- Bundled dependency licenses: MIT, BSD, Apache-2.0, ISC, MPL-2.0 (unmodified), OFL-1.1 (fonts). Never add `@maptiler/weather`, not even as a devDependency.
- `./data` and `./stores` must not reach maplibre or MapTiler: run `npm run test:bundle` before every commit touching `src/lib`.
- Every UI string is a `mapsdk_*` key in `src/lib/data/messages/en.json`; no concatenated sentences.
- Colors come from a `Scale` or theme tokens, except these fixed defaults (the user's decisions): inactive monitors `#969696`, the inside-monitor outline `#000000`, the collocation crosshair `#4A5FC6`.
- `SpatialSelection` keeps its shape (`{ kind: "monitors" | "regions"; ids: string[] }`).
- Existing behavior is unchanged unless a task says so: every new option defaults to today's map-sdk behavior. The only default changes are the monitor colors (Task 9) and the credits (Task 5).
- Respect `prefers-reduced-motion` in every camera move (duration 0).
- Each task that changes public API updates `README.md` and, where it shows an example, `tests/unit/readme-examples.test.ts`.
- Code style: tabs, double quotes, no trailing commas, width 100; `npm run format`, `npm run lint`, `npm run check` clean before each commit.

## Review Focus

1. **Detaching while a camera move or the ready wait is pending** (`active` toggled off, basemap changed). Nothing throws, and `ready` goes back to false. Pinned in Task 2.
2. **Switching basemaps with a custom layer added.** The layer comes back in its slot after the restyle and is removed exactly once on teardown. Pinned in Task 6.
3. **Changing the selection on an `"enlarge"` plugin while its data refreshes** (monitors poll every 2 minutes). The selected icon stays 1.3×, with no ring left behind. Pinned in Task 10.
4. **A collocation site whose reference or collocated monitor isn't in the monitors store** (inactive, filtered out, or not loaded yet). The site still draws, in the neutral color with "No reading", and never throws. Pinned in Task 17.
5. **HMS stores on a day with no data** (common on the local stack). Status is `ready`, the collection is empty, and the legend still shows. Pinned in Task 16.

---

### Task 1: Camera moves on `MapContext` (spec 1)

**Files:**
- Modify: `src/lib/core/gl.ts` (add `flyTo`, `fitBounds` to `GlMapLike`), `src/lib/core/create-map.svelte.ts`, `tests/fixtures/fake-gl.ts`
- Test: `tests/client/core/camera.test.ts`

**Interfaces:**
- Produces on `MapContext`:
  - `easeTo(target: CameraTarget): void`
  - `flyTo(target: CameraTarget): void`
  - `fitBounds(bounds: Bounds, options?: { padding?: number; maxZoom?: number }): void`
  - `export interface CameraTarget { center: [number, number]; zoom?: number; minZoom?: number }`. `minZoom` means "zoom to at least this", i.e. `max(current, minZoom)`; `zoom` wins when both are given.
- Produces: `FeatureClickHandler`'s event gains `lngLat: [number, number]`. For a map click it's the click point; from `pickFromList` it's the item's `lngLat`.
- All four do nothing while detached or destroyed, and pass `duration: 0` under reduced motion.

- [ ] **Step 1: Write the failing tests** (`tests/client/core/camera.test.ts`, with `createFakeGl`)
  - `easeTo with minZoom keeps a deeper zoom`: at zoom 13, `easeTo({ center: [1, 2], minZoom: 12 })`, so the fake records `{ center: [1, 2], zoom: 13 }`.
  - `easeTo with minZoom zooms in from a shallower zoom`: at 7 → `zoom: 12`.
  - `flyTo passes zoom 16`: the fake records `flyTo` with `zoom: 16`.
  - `fitBounds passes padding and maxZoom`.
  - `camera moves under reduced motion have duration 0`: stub `matchMedia`.
  - `camera moves while detached do nothing`: no throw, nothing recorded.
  - `featureclick carries the click lngLat`: router click at a hit with `lngLat {lng: 1, lat: 2}`, so the handler receives `lngLat: [1, 2]`.
  - `pickFromList featureclick carries the item lngLat`.
- [ ] **Step 2: Run** `npx vitest run --project client tests/client/core/camera.test.ts`. Expected: FAIL (methods missing).
- [ ] **Step 3: Implement.** `#emitClick(pluginId, ref, lngLat)`. The fake GL records `flyTo`/`fitBounds` calls like `easeTo`.
- [ ] **Step 4: Run** the same command, then `npm test`. Expected: PASS, and the existing tests are unchanged.
- [ ] **Step 5: README** (Camera section) **and commit** `Camera moves on MapContext; featureclick carries lngLat`.

### Task 2: Ready signal and reaching the GL map (spec 2, 3)

**Files:**
- Modify: `src/lib/core/create-map.svelte.ts`, `src/lib/view/create-gl-map.ts`, `src/lib/view/MapView.svelte`, `src/lib/index.ts`
- Test: `tests/client/core/ready.test.ts`, `tests/browser/map-view.browser.test.ts`

**Interfaces:**
- Produces on `MapContext`:
  - `readonly ready: boolean`: reactive. True after the attached map's first `idle` once its style is loaded. False again on `detach()` and while a basemap switch reloads the style.
  - `readonly gl: GlMapLike | null`: reactive; the attached map, or `null`.
  - `markReady(): void`: for MapView only.
- Produces in `src/lib/index.ts`: `export function maptilerMap(map: MapContext): import("@maptiler/sdk").Map | null`, which returns `map.gl` as the MapTiler `Map`. Document it as the escape hatch for markers and popups only; the host must never add sources or layers through it.

- [ ] **Step 1: Failing tests.**
  - client:
    - `ready is false until markReady after attach`
    - `detach clears ready`
    - `a basemap switch clears ready until the next markReady`
    - `markReady after detach does nothing`
    - `gl is the attached map and null after detach`
  - browser: `MapView sets ready after the first idle`, using the e2e local style the browser tests already use.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** In `createGlMap` or MapView, call `gl.once("idle", …)` per style load and `ctx.markReady()`. The basemap's restyle path clears `ready`.
- [ ] **Step 4: Run** the client and browser projects. Expected: PASS.
- [ ] **Step 5: README** (the `ready` and `maptilerMap` sections) **and commit**.

### Task 3: Globe and space options (spec 4)

**Files:** Modify `src/lib/core/create-map.svelte.ts` (`MapConfig`) and `src/lib/view/create-gl-map.ts`. Test: `tests/browser/map-view.browser.test.ts`.

**Interfaces:**
- `MapConfig.projection?: "mercator" | "globe"`, default `"mercator"`.
- `MapConfig.space?: false | { preset: string }`, default `false`. monitor-map passes `{ preset: "milkyway" }`.
- Both pass straight into the MapTiler `Map` options (`projection`, `space`), and only when set, so today's maps get exactly today's constructor options.

- [ ] **Step 1: Failing browser tests.**
  - `globe projection reaches the map`: `isGlobeProjection()` is true.
  - `default stays mercator`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: README and commit.**

### Task 4: Choosing `MapView`'s built-in pieces (spec 5, 23)

**Files:** Modify `src/lib/view/MapView.svelte`, `src/lib/view/create-gl-map.ts`, `README.md`. Test: `tests/browser/controls.browser.test.ts`.

**Interfaces:**
- New `MapView` props:
  - `selectionBar?: boolean`, default `true`.
  - `controls?: "mapsdk" | "engine" | "none"`, default `"mapsdk"`.
- `"engine"` adds the MapTiler/MapLibre `NavigationControl` (zoom and compass, `visualizePitch: false`) and `GeolocateControl` (`trackUserLocation: true`, `showAccuracyCircle: true`), both at `"top-right"`, as monitor-map's defaults do.
- `"none"` draws no zoom controls. The credits are Task 5's and always show.
- `MapControls` keeps its zoom buttons and gains nothing.

- [ ] **Step 1: Failing browser tests.**
  - `selectionBar false leaves the bar out with a selection set`.
  - `controls engine shows the compass and locate buttons and not mapsdk zoom buttons`: query `.maplibregl-ctrl-compass` and `.maplibregl-ctrl-geolocate`.
  - `controls none shows no zoom buttons`.
  - `default still shows mapsdk zoom buttons`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Engine controls are added when the GL map is created and go with it. Fix the README lines that say `MapView` has basemap controls.
- [ ] **Step 4: Run** `npm run test:browser`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Credits through the engine's attribution control (spec 6)

**Files:**
- Modify: `src/lib/view/create-gl-map.ts` (stop forcing no attribution), `src/lib/ui/MapControls.svelte` (remove the credits row, logo, and URL constants), `src/lib/view/MapView.svelte`, `src/lib/data/messages/en.json`
- Test: `tests/browser/controls.browser.test.ts`, `e2e/demo.spec.ts`

**Interfaces:**
- Consumes `map.metadata.attribution(dataset)` (the existing data-credit fetch and retry logic moves out of `MapControls` into a small module, `src/lib/ui/data-credits.svelte.ts`).
- Produces a MapLibre `AttributionControl` with `compact` left unset, so it's automatic: full on maps wider than 640px; at 640px and narrower it starts open and collapses on the first drag. Its `customAttribution` is the data credits.
  - When the credits change, replace the control (remove it and add a new one).
  - "© MapTiler" and "© OpenStreetMap contributors" come from the style's sources, as on today's map.
- Logo: don't draw one. Pass no `maptilerLogo` override, so MapTiler's SDK shows its logo only when the key's plan requires it.
- Remove `mapsdk_credit_maptiler`, `mapsdk_credit_osm`, `mapsdk_logo_maptiler` and `mapsdk_attribution_label` from `en.json` if nothing else uses them.

- [ ] **Step 1: Failing tests.**
  - browser:
    - `credits show MapTiler and OpenStreetMap text`, read from `.maplibregl-ctrl-attrib`.
    - `a narrow map starts with credits open and collapses on drag`: a 600px container; fire a `drag` event; check the `maplibregl-compact-show` class.
    - `data credits appear in the attribution`: a plugin with `dataset` and a stub metadata `attribution` returning `"SJVAir"`.
    - `no hand-drawn logo`: no `img[src*="logo.svg"]` inside `.mapsdk-credits`.
  - e2e (demo): `credits line is present` on Chromium and Firefox.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Check that the e2e local style carries the © text in its sources' `attribution`; add it to the fixture style if not.
- [ ] **Step 4: Run** `npm run test:browser` and `npx playwright test --project chromium --project firefox`. Expected: PASS.
- [ ] **Step 5: Commit** `Credits through the map engine's attribution control`.

### Task 6: Custom layers from host plugins (spec 9)

**Files:** Modify `src/lib/core/plugin.ts`, `src/lib/core/plugin-host.svelte.ts`, `src/lib/core/gl.ts`, `tests/fixtures/fake-gl.ts`. Test: `tests/client/core/plugin-host.test.ts`.

**Interfaces:**
- `PluginContext.addCustomLayer(local: string, create: (id: string) => CustomLayerInterface): string`.
  - It calls `create(id(local))` and adds the returned object as is (not spread), in the plugin's draw-order slot.
  - It tracks the layer like `addLayer`, so it's removed on teardown, re-added on restyle, and moved with `movePlugin`.
  - `CustomLayerInterface` is a type import from `@maptiler/sdk`.
- `GlMapLike.addLayer(layer: LayerSpecification | CustomLayerInterface, beforeId?: string)`.

- [ ] **Step 1: Failing tests**, with a stand-in object `{ id, type: "custom", render() {} }`:
  - `addCustomLayer adds the same object, not a copy`: the fake receives an identical reference.
  - `custom layer sits in its plugin's slot`: a plugin added `before` another lands below that plugin's layers.
  - `custom layer is re-added after a restyle and removed once on teardown`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run --project client`. Expected: PASS.
- [ ] **Step 5: README** ("Writing your own plugin", with a wind-style example that never names `@maptiler/weather` as a dependency) **and commit**.

### Task 7: Pointer cursor and hover priority (spec 7, 8)

**Files:** Modify `src/lib/core/interactions.svelte.ts`, `src/lib/core/plugin.ts`, `src/lib/core/create-map.svelte.ts`. Test: `tests/client/core/interactions.test.ts`.

**Interfaces:**
- `MapPlugin.hoverPriority?: number`, default 0.
  - Hover picks, among the hits under the pointer, the hit whose plugin has the highest priority. Ties go to the topmost.
  - A blocking cluster bubble on top still blocks; priority doesn't reach under it.
  - Clicks stay topmost-first, unchanged.
- Cursor: the router sets the canvas's `style.cursor` to `"pointer"` while `hovered` is non-null or the pointer is over a blocking layer, and clears it otherwise and on detach.

- [ ] **Step 1: Failing tests.**
  - `hover prefers the higher-priority plugin under a lower-drawn feature`.
  - `equal priority keeps topmost`.
  - `click ignores priority`.
  - `cursor is pointer over a hit and cleared on mouseout`.
  - `cursor is pointer over a cluster bubble`.
  - `detach clears the cursor`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The router needs each registration's plugin priority: pass it in `interactive`/`blocking` registration from the plugin host.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Monitors store metadata is public (spec 14)

**Files:** Modify `src/lib/stores/monitors-store.svelte.ts`. Test: `tests/unit/stores/monitors-store.test.ts`.

**Interfaces:** `MonitorsStore.meta: MonitorsMeta | null` is read-only and reactive: `null` before init, and the meta from init after. It's the SDK's `MonitorsMeta` type.

- [ ] **Step 1: Failing tests.**
  - `meta is null before init`.
  - `meta is the fetched monitors meta after init`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, as a getter over `#meta`.
- [ ] **Step 4: Run**, then `npm run test:bundle`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: Fixed monitor colors (spec 10)

**Files:** Modify `src/lib/plugins/points.svelte.ts` (`icon.mutedColor`) and `src/lib/presets/monitors.ts`. Test: `tests/client/presets/monitors.test.ts`.

**Interfaces:**
- `PointsOptions.icon.mutedColor?: string`: the color of muted images; defaults to `theme.mutedForeground`, as today.
- `monitorsPlugin` passes `mutedColor: "#969696"` and draws the inside outline with `"#000000"`, never from `theme`.
- Export both values as `MONITOR_INACTIVE_COLOR` and `MONITOR_INSIDE_OUTLINE` from `presets/monitors.ts`. Comment them as the user's decision (2026-11-04), an exception to the theme-token rule.

- [ ] **Step 1: Failing tests.**
  - `inactive monitor image is drawn #969696`: inspect the SVG passed to `addImage` or `draw`.
  - `inside outline is black in a dark theme`: theme foreground `#ffffff`, outline stroke `#000000`.
  - `points muted default still uses theme mutedForeground`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Update `CLAUDE.md`'s "Rules that bind new code" with the three fixed colors as named exceptions.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 10: Selected style "enlarge" (spec 11)

**Files:** Modify `src/lib/plugins/points.svelte.ts`, `src/lib/presets/monitors.ts`, `src/lib/core/gl.ts` (`setLayoutProperty`), `tests/fixtures/fake-gl.ts`. Test: `tests/client/plugins/points.test.ts`.

**Interfaces:**
- `PointsOptions.selectedStyle?: "ring" | "enlarge"`, default `"ring"`. Passed through by `MonitorsPluginOptions.selectedStyle`.
- `"enlarge"`:
  - No selected overlay layers.
  - The point layer's `icon-size` becomes `["case", ["in", ["get", "refKey"], ["literal", [...selectedKeys]]], 1.3 / IMAGE_RATIO, 1 / IMAGE_RATIO]`, updated with `setLayoutProperty` when the selection changes.
  - `icon-size` is a layout property, so feature-state can't drive it.
- `GlMapLike.setLayoutProperty(layerId: string, name: string, value: unknown): void`.

- [ ] **Step 1: Failing tests.**
  - `enlarge adds no selected overlay layers`.
  - `enlarge sets icon-size 1.3x for the selected key`.
  - `enlarge follows selection changes`.
  - `enlarge keeps the selected size after a data refresh` (Review Focus 3).
  - `ring default unchanged`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: Tooltip that follows the pointer (spec 12)

**Files:** Modify `src/lib/ui/MapTooltip.svelte` and `src/lib/view/MapView.svelte`. Test: `tests/browser/tooltip.browser.test.ts`.

**Interfaces:** `MapView` prop `tooltip?: "pinned" | "pointer"`, default `"pinned"` (today's map-sdk behavior).
- `"pointer"`: the tooltip shows at the last pointer position. It hides on the map's `zoomstart` and stays hidden until the next pointer move over a hit.
- Keyboard focus from the feature list shows the tooltip as in `"pinned"`.

- [ ] **Step 1: Failing browser tests.**
  - `pointer mode hides the tooltip on zoom`.
  - `pointer mode shows it again on the next move`.
  - `pinned mode keeps it through a zoom`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 12: The "(N avg)" note (spec 13)

**Files:**
- Modify: `src/lib/data/metadata.ts`, `src/lib/presets/MonitorReadingBox.svelte`, `src/lib/presets/MonitorTooltip.svelte`, `src/lib/presets/monitors.ts`, `src/lib/data/messages/en.json`
- Test: `tests/unit/data/metadata.test.ts`, `tests/browser/monitor-tooltips.browser.test.ts`

**Interfaces:**
- `MetadataProvider.monitorTypeInterval?(type: string, signal?: AbortSignal): Promise<string | "unavailable">`. It's optional, so hosts with their own provider (the dashboard) don't break; the tooltip omits the note when it's missing.
- The default provider reads the monitors meta's `monitors[type].expected_interval` (e.g. `"1 hour"`, `"2 min"`).
- New message `"mapsdk_monitor_interval_avg": "({interval} avg)"`. It's the reading box's subheading under the entry-type label, as in monitor-map's `MonitorTooltip.svelte`.
- `MonitorTooltip` gains the prop `interval: string | null`.

- [ ] **Step 1: Failing tests.**
  - unit:
    - `monitorTypeInterval returns expected_interval`.
    - `unknown type is unavailable`.
  - browser:
    - `monitor tooltip shows (1 hour avg) for airnow`.
    - `no note when the provider lacks monitorTypeInterval`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Resolve the interval per monitor type the way the cluster tooltip resolves `monitorTypeLabel` (cached per type).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** Update the "(1-hour avg)" deferral when the PR merges (Task 20).

### Task 13: Smoke outline in the plume's color (spec 15)

**Files:** Modify `src/lib/plugins/shapes.svelte.ts` and `src/lib/presets/hms-smoke.ts`. Test: `tests/client/plugins/shapes.test.ts`, `tests/client/presets/hms.test.ts`.

**Interfaces:**
- `ShapesOptions.outline?: "theme" | "level" | "none"`, default `"theme"` (today).
  - `"level"`: the outline's `line-color` is `colorExpression(scale, "value", theme.neutral)` and its `line-opacity` is `opacityExpression(scale, "value", fillOpacity)`, so the edge is faint like today's fill outline. Width stays 1.
  - `"none"`: no outline layer. Hover then registers on the fill only.
- `hmsSmokePlugin` passes `outline: "level"`.

- [ ] **Step 1: Failing tests.**
  - `outline level paints line-color from the scale`.
  - `outline none adds no outline layer and fill stays interactive`.
  - `hmsSmokePlugin uses level outline`.
  - `default theme outline unchanged`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 14: Fire zoom ranges and `cleanFires` (spec 16)

**Files:**
- Modify: `src/lib/plugins/points.svelte.ts`, `src/lib/presets/hms-fire.ts`, `src/lib/presets/fire-groups.ts`, `src/lib/stores/index.ts` (export `cleanFires`), `src/lib/index.ts`
- Test: `tests/client/plugins/points.test.ts`, `tests/unit/presets/fire-groups.test.ts`

**Interfaces:**
- `PointsOptions.zoomRange?: { min?: number; max?: number }`. Applied as every layer's `minzoom`/`maxzoom`: MapLibre's `minzoom` is inclusive and `maxzoom` exclusive.
- `HmsFirePluginOptions` gains `zoomRange` and `listed?: boolean` (default true).
- monitor-map then adds `hmsFirePlugin({ id: "hms-fire-groups", zoomRange: { max: 10 } })` and `hmsFirePlugin({ id: "hms-fire-hotspots", zoomRange: { min: 10 }, listed: false })`. The groups stay listed, so keyboard users reach every fire.
- `export function cleanFires<F extends FireDetection>(fires: F[]): F[]`: drops fires without a finite FRP, keeps one per coordinates, latest by timestamp. `groupFires` uses it. Export it from `./stores` too (map-free), next to Task 16's store.
- While here: trace the "hms-fire icon could not be loaded" warning (`DEFERRED.md`). Fix it if the cause is the image loading after the layer; otherwise note what was found in the PR.

- [ ] **Step 1: Failing tests.**
  - `zoomRange sets minzoom and maxzoom on every layer` (points, clusters, overlays).
  - `cleanFires drops null frp`.
  - `cleanFires keeps the latest of duplicates`.
  - `groupFires output unchanged`: the existing fixtures.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 15: Legend blocks for range scales and top-first order (spec 17, 18)

**Files:** Modify `src/lib/core/plugin.ts` (`LegendData`), `src/lib/ui/legend-data.ts`, `src/lib/ui/Legend.svelte`, `src/lib/plugins/points.svelte.ts` (pass-through), `src/lib/presets/hms-fire.ts`. Test: `tests/unit/ui/legend-data.test.ts`, `tests/browser/legend.browser.test.ts`.

**Interfaces:**
- `LegendData`'s scale variant gains `display?: "gradient" | "blocks"`.
  - Absent: range scales are a gradient and category scales are blocks, as today.
  - `"blocks"` on a range scale renders blocks labeled with the levels' own labels. The server's fire labels are `<10`, `10–49`, `50–149`, `150–349`, `≥350`.
- `PointsOptions.legendDisplay?: "gradient" | "blocks"`. `hmsFirePlugin` passes `"blocks"`.
- `Legend` prop `order?: "bottom-first" | "top-first"`, default `"bottom-first"` (today).

- [ ] **Step 1: Failing tests.**
  - unit:
    - `range scale with display blocks gives blocks with level labels`.
    - `no display keeps the gradient`.
  - browser: `top-first lists the top plugin first`, with three plugins.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 16: Live HMS stores (spec 20)

**Files:**
- Create: `src/lib/stores/hms-stores.svelte.ts`, `src/lib/stores/load-once.svelte.ts` (the shared init/status/retry/abort core)
- Modify: `src/lib/stores/index.ts`, `src/lib/data/messages/en.json`
- Test: `tests/unit/stores/hms-stores.test.ts`

**Interfaces:**
- `createHmsSmokeStore(options?: { messages?: MessageProvider }): HmsSmokeStore`
  - `{ status: DataStatus; dataSource: DataSource; init(options?: SignalOptions): Promise<void>; dispose(): void }`.
  - It fetches `getHMSSmoke(undefined, { signal })`, i.e. today's data.
  - Features: `refKey: encodeRef({ kind: "feature", id })`, `name: messages("mapsdk_hms_smoke_name")`, `value: density`.
  - Scale ref: `{ dataset: "hms-smoke", entryType: "smoke-density" }`.
- `createHmsFireStore(options?)`: `{ status; groups: DataSource; hotspots: DataSource; init; dispose }`.
  - It fetches `getHMSFire(undefined, { signal })`.
  - `hotspots` are `cleanFires` output, each named `mapsdk_hms_fire_detection`.
  - `groups` are `groupFires` output, named `mapsdk_hms_fire_detection` (count 1) or `mapsdk_hms_fire_detections` (`{count}`), with value `avgFrp`.
  - Scale ref: `{ dataset: "hms-fire", entryType: "fire-frp" }`.
- New messages:
  - `"mapsdk_hms_smoke_name": "Smoke"`
  - `"mapsdk_hms_fire_detection": "Fire detection"`
  - `"mapsdk_hms_fire_detections": "{count} fire detections"`
- Init rules, as `createMonitorsStore`: overlapping calls share one run; a failed run can be retried and status gives `retry`; a signal-carrying caller's abort rejects only that caller; there's no polling (loads once, as monitor-map 4.3 does); `dispose` cancels.

- [ ] **Step 1: Failing tests** (mock `@sjvair/sdk` as `tests/unit/stores/monitors-store.test.ts` does):
  - `smoke store loads today's plumes once`.
  - `fire store gives cleaned hotspots and groups`.
  - `empty day is ready with an empty collection` (Review Focus 5).
  - `failed load reports error with retry and retry loads`.
  - `concurrent init shares one request`.
  - `dispose aborts in-flight`.
- [ ] **Step 2: Run** `npx vitest run --project unit tests/unit/stores/hms-stores.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write `load-once` so Task 17 reuses it.
- [ ] **Step 4: Run**, then `npm run test:bundle`. Expected: PASS, and `./stores` stays off the map engine.
- [ ] **Step 5: README** (Stores) **and commit**.

### Task 17: Collocation sites: store, preset, and shared marker shapes (spec 19, 20, 21)

**Files:**
- Create: `src/lib/stores/collocation-store.svelte.ts`, `src/lib/presets/collocation-sites.ts`, `src/lib/presets/CollocationTooltip.svelte`
- Modify: `src/lib/plugins/icons.ts` (add `withCrosshair`), `src/lib/index.ts`, `src/lib/stores/index.ts`, `src/lib/data/types.ts`, `src/lib/data/messages/en.json`
- Test: `tests/unit/stores/collocation-store.test.ts`, `tests/client/presets/collocation.test.ts`, `tests/browser/monitor-tooltips.browser.test.ts`

**Interfaces:**
- `CollocationFeatureProperties extends MonitorFeatureProperties`, which takes the reference monitor's type, location, isActive, isSjvair, value and timestamp, plus:
  - `colocatedId: string`, `colocatedName: string | null`, `colocatedValue: number | null`, `colocatedTimestamp: string | null`.
  - `refKey` is `encodeRef({ kind: "feature", id: site.id })`.
- `createCollocationSitesStore(options: { monitors: MonitorsStore }): CollocationSitesStore`
  - `{ status; dataSource: DataSource<CollocationFeatureProperties>; init(options?); dispose() }`.
  - It loads `getCollocationSites()` once (Task 16's `load-once`).
  - `dataSource.features` is derived: it joins each site's `reference_id` and `colocated_id` to `monitors.monitors` and `monitors.latest`, so the readings follow polling.
  - Its scale is the monitors store's `dataSource.scale`.
  - A missing monitor gives `value: null` and keeps the site's own `name` and `position` (Review Focus 4).
- `collocationSitesPlugin(options: { id?: string /* "collocation-sites" */; source: DataSource<CollocationFeatureProperties>; layerLabel: string }): MapPlugin`
  - A `pointsPlugin` icon drawn as `withCrosshair(SHAPES[monitorShape(type)](color, 2, insideOutline), COLLOCATION_CROSSHAIR_COLOR)` at monitor-map's crosshair size.
  - `COLLOCATION_CROSSHAIR_COLOR = "#4A5FC6"`.
  - `selectable: false` and listed. Set `hoverPriority = Number.MAX_SAFE_INTEGER` on the plugin `pointsPlugin` returns (Task 7's `MapPlugin` field).
  - Its tooltip is `CollocationTooltip`: two `MonitorReadingBox`es, reference and collocated, each with its time and level label. Copy and layout follow monitor-map's `src/lib/collocation-sites/CollocationTooltip.svelte`, with every string a new `mapsdk_collocation_*` key.
- Export `circle`, `square`, `triangle`, `withCrosshair` from `src/lib/index.ts`. Keep their current signatures in `plugins/icons.ts`.

- [ ] **Step 1: Failing tests.**
  - unit:
    - `joins sites to reference and collocated readings`.
    - `readings follow a monitors store update`.
    - `missing monitor gives a null reading and keeps the site` (Review Focus 4).
    - `load failure gives retry`.
  - client:
    - `collocation icon wraps the reference shape in the crosshair color`.
    - `collocation hover wins over a monitor drawn above`.
    - `not selectable`.
  - browser: `collocation tooltip shows both readings`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all projects, then `npm run test:bundle`. Expected: PASS.
- [ ] **Step 5: README and commit.**

### Task 18: Demo, e2e, and the parity check

**Files:** Modify `demo/App.svelte`, `demo/date-range-source.svelte.ts` (unchanged unless needed), `e2e/demo.spec.ts`, `e2e/fixtures/*`.

- [ ] **Step 1: Add a "Live map" section to the demo**, with today's monitor-map setup on map-sdk:
  - `createMonitorsStore`, the HMS stores and the collocation store;
  - monitors with `selectedStyle: "enlarge"`;
  - collocation sites;
  - smoke, and fire groups and hotspots by zoom;
  - `projection: "globe"`, `space: { preset: "milkyway" }`, `controls="engine"`, `selectionBar={false}`, `tooltip="pointer"`;
  - `Legend order="top-first"`;
  - `excludedLayers: []`, by passing `basemaps` with every Streets v4 variant;
  - a click that eases to `minZoom: 12`.

  Keep the existing date-range maps as they are.
- [ ] **Step 2: e2e:** the live section renders; collocation and fire fixtures route like the existing ones; there are no WCAG 2.2 AA violations in light and dark; the credits line is present.
- [ ] **Step 3: Run** `npx playwright test --project chromium --project firefox` and `npm test`. Expected: PASS.
- [ ] **Step 4: Parity check with the user.** Run the demo and `http://localhost:8000/` (monitor-map 4.3 on the local stack) side by side in the browser, at the same view and pollutant. Send the user screenshots of both and list every visible difference. The user judges; differences the spec keeps (fixes and accessibility) are expected. Fix anything else, or record it with the user's say-so.
- [ ] **Step 5: Commit.**

### Task 19: Remove the legacy `levels` fallback (spec 22), when its SDK beta exists

**Precondition:** sdk-js has published the 5.0 beta that drops `levels` from the monitors meta. Ask sdk-js (`ListAgents`; the session was `sdk-js-8c`) and copy the coordinator. If it isn't out when Tasks 1–18 are done, open the PR without this task and track it on the PR and in data-dashboard `TODO.md`. It still must land before go-live.

**Files:** Modify `package.json` (exact dev pin to that beta; the peer range stays `^5.0.0-beta.2` unless that beta is needed at runtime, in which case raise the floor to it and tell the coordinator), `src/lib/data/metadata.ts`, `src/lib/data/scale.ts`. Test: `tests/unit/data/metadata.test.ts`, `tests/unit/data/scale.test.ts`.

- [ ] **Step 1:** Bump the pin, then `npm install` and `npm run check`. Expected: type errors at the `entry.levels` use.
- [ ] **Step 2:** Delete `scaleFromLegacyLevels`, its use in `metadata.ts`, and their tests. A missing `scale` gives `"unavailable"`.
- [ ] **Step 3: Test** `monitors meta without scale is unavailable`.
- [ ] **Step 4: Run** everything: check, lint, all test projects, test:bundle, test:licenses, e2e on Chromium and Firefox. Expected: PASS.
- [ ] **Step 5: Commit** `Drop the legacy levels fallback (SDK <beta>)`.

### Task 20: Finish: docs, PR, coordinator

- [ ] **Step 1:** Run the full check: `npm run check && npm run lint && npm test && npm run test:bundle && npm run test:licenses`, plus e2e on Chromium and Firefox. Expected: all pass.
- [ ] **Step 2:** Update `CLAUDE.md`'s architecture overview with the new stores and preset, `MapView`'s props, and the fixed-color exceptions.
- [ ] **Step 3:** Open the PR into `main`. The body lists the spec items done, the parity-check outcome, and whether Task 19 is in.
- [ ] **Step 4:** Update data-dashboard docs from `.worktrees/docs-map-sdk`:
  - `TODO.md` step 5;
  - remove the `DEFERRED.md` entries this closes on merge ("map-sdk milestone 2", "Globe projection", "(1-hour avg)", and "hms-fire icon" if fixed).

  Then tell the coordinator about the PR and the API additions the dashboard's Map widget will see: credits, the monitor colors, the optional `monitorTypeInterval` on custom metadata providers, and the `featureclick` `lngLat`.
- [ ] **Step 5:** Stop. Merging needs the user's yes, and any release needs its own yes.
