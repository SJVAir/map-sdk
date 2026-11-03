# `@sjvair/map-sdk`: milestone 1 design

Date: 2026-11-03. Status: draft for review.
Release 1, step 5, part 1 (data-dashboard `ROADMAP.md` item 5, `TODO.md` → "Release 1, step 5").

## Intent

`@sjvair/map-sdk` is a Svelte 5 library that puts SJVAir data on one or more maps on the same
page. It is split out of `@sjvair/monitor-map` (4.3.0), which can only run one map per page
because its map, plugin registry, click handling, and config are module-level singletons.

Two consumers will build on it, in this priority order:

1. **The SJVAir Dashboard's Map widget** (data-dashboard, Release 1). This is the critical path.
   A dashboard can hold several Map widgets, each with its own layers, date range, and
   selection, and widgets that are minimized or off screen must release their WebGL context.
2. **monitor-map 5.0**, the live map on sjvair.com and the mobile app's map, rebuilt on map-sdk
   later. Until then the user keeps shipping changes from the current monitor-map repo, so
   map-sdk does not need monitor-map parity to be useful.

The settled architecture is in data-dashboard `ARCHITECTURE.md` → "Map SDK". This spec turns it
into a buildable milestone and records where it refines that section.

## Milestones

- **Milestone 1 (this spec): what the dashboard needs.** The per-map core, the plugin interface,
  general plugins for points and shapes, presets for the six datasets the dashboard puts on a
  map at launch, `MapView`, selection, the finished on-screen pieces, the three providers with
  defaults, `createMonitorsStore()`, and a demo page. Published as `0.x` pre-releases.
- **Milestone 2 (a later map-sdk spec): monitor-map parity.** Collocation sites, EV stations,
  wind, live stores for the other datasets, and whatever else the monitor-map 5.0 rebuild finds
  missing. It starts when someone is ready to begin that rebuild.
- **1.0** is cut only after both the Map widget and the monitor-map rebuild have validated the
  API (already decided).

## Goals

1. Any number of independent maps on one page, with nothing module-global.
2. Show any dataset that has coordinates or shapes: points, polygons and lines, value-filled
   shapes (choropleths), and later rasters, without a new plugin for each dataset.
3. Milestone 1 datasets, all as presets: **monitors, region fill, HMS smoke, HMS fire,
   CalHeatScore ZIPs, and forecast zones.**
4. The same plugins render live data (monitor-map, mobile) and date-range data (dashboard).
5. Multi-select of features per layer, synced both ways with the host.
6. Fully usable by keyboard and screen reader, meeting WCAG 2.2 AA.
7. The same look as today's live map, so visitors see no change after the 5.0 rebuild.
8. The compatibility surface the 5.0 rebuild must keep for mobile stays buildable on map-sdk:
   an app-wide monitors store usable with no map, the `/core` and `/routes` entry points, the
   `monitor/:id?pollutant=` route, and `dist/lib`.

## Non-goals (milestone 1)

- The dashboard's Map widget (data-dashboard, later) and the monitor-map 5.0 rebuild (later).
- Routing, page layouts, load screens, detail panels, `MapShell`, and monitor-map's options
  toolbar and panel. These stay in monitor-map.
- Collocation sites, EV stations, wind, and the other deferred dataset plugins (pesticides,
  CalEnviroScreen tracts, emissions facilities, TEMPO).
- Live stores other than monitors.
- Fetching date-range data. The dashboard feeds its own data layer's results in.
- Importing user GeoJSON or CSV files (but see "Ready for user files").
- Drawn-shape selection (the later `terra-draw` plugin).
- Time scrubbing inside a map (decided against earlier).

## Anti-goals: it fails if…

- two maps on one page interfere with each other, or a rebuilt map leaks state from the old one;
- any label, unit, breakpoint, color, or scale is hardcoded instead of read from metadata;
- meaning is carried by color alone, or a feature can only be reached with a mouse;
- importing the stores pulls the map engine into the bundle (mobile and `/core` need stores
  without a map);
- visitors to the live map would notice a different look after the 5.0 rebuild;
- a dependency is outside the license policy.

## Constraints

- **License:** MIT, `Copyright (c) 2026 Central California Asthma Collaborative (SJVAir)`.
  Bundled dependencies must be MIT, BSD, Apache-2.0, ISC, MPL-2.0 (unmodified), or OFL-1.1
  (fonts only). `@maptiler/sdk`, `@maptiler/client`, and `maplibre-gl` are BSD-3-Clause.
  **`@maptiler/weather` is proprietary** (for use only with an active MapTiler account), so
  map-sdk must not depend on it (see milestone 2 decisions).
- **Browsers:** Chrome/Edge 111+, Safari 16.4+, Firefox 128+.
- **Tree-shakeable.** The dashboard lazy-loads the Map widget. `sideEffects` lists only CSS.
- **Code style matches the dashboard:** Svelte 5 runes only, TypeScript, tabs, double quotes,
  no trailing commas, print width 100, Prettier and ESLint flat config, Tailwind v4.
- **Metadata as source of truth:** labels, units, breakpoints, colors, and scales come from
  server metadata, through the `metadata` provider or its default fetcher. When the server lacks
  a value, the fix is server metadata and an `@sjvair/sdk` change, requested from the session
  that owns sdk-js, never a hardcoded stand-in.
- **i18n:** every UI string is a message key with an English default. No string-concatenated
  sentences; one message with parameters per sentence.
- **Time:** all formatting in Pacific time (America/Los_Angeles), through the `format` provider.
- **WebGL budget:** browsers allow roughly 8–16 live WebGL contexts per page, one per map.
- **Never publish or tag a release without the user's explicit yes for that specific release.**

## Architecture

### Package entry points

| Entry                    | Contains                                                             | May reach the map engine? |
| ------------------------ | -------------------------------------------------------------------- | ------------------------- |
| `@sjvair/map-sdk`        | `createMap`, `MapView`, plugins, presets, UI components, types       | Yes                       |
| `@sjvair/map-sdk/stores` | `createMonitorsStore()` and the store types                          | **No** (checked in CI)    |
| `@sjvair/map-sdk/data`   | Data-source and scale types, provider interfaces, and their defaults | **No** (checked in CI)    |

Built with `svelte-package` into `dist/` (`.svelte` files ship uncompiled, as monitor-map's do).
A bundle check like monitor-map's `test:bundle` fails CI if `maplibre-gl` or `@maptiler/*` is
reachable from `/stores` or `/data` without a dynamic import. Hosts add one `@source` line so
their Tailwind scans the package.

**Peer dependencies:** `svelte` 5, and `@sjvair/sdk` (consumed as
`npm:@jsr/sjvair__sdk@…`). The SDK is a peer so there is only one copy, and the host's
`setOrigin()` and request defaults apply to map-sdk's requests. This is the nested-copy problem
noted for mobile in `DEFERRED.md`. Any UI primitives map-sdk uses (bits-ui) are peers too, since
both hosts already have them.

### `createMap` and `MapContext`

```ts
const map = createMap({
	config: { maptilerKey, basemaps?, initialView?, cooperativeGestures? },
	metadata?: MetadataProvider,
	messages?: MessageProvider,
	format?: FormatProvider
});
```

`createMap` returns a `MapContext`: the map's state and services, independent of whether a GL
map currently exists. It owns:

- the plugin registry (add, remove, order);
- the camera (center, zoom, bearing, pitch) and the current basemap;
- each plugin's selection and selection mode;
- the click, hover, and tooltip routing that today lives in the `clickManager` and tooltip
  singletons;
- the resolved providers.

`<MapView map={map} active={…} />` attaches a MapTiler/MapLibre map to the context and renders
the on-screen pieces. `MapView` provides the context to its descendants through Svelte context.

**Releasing the WebGL context.** Setting `active={false}`, or unmounting `MapView`, destroys
the GL map and runs every plugin's teardown. The `MapContext` and its state stay. When the map
is shown again, the GL map is rebuilt with the same camera, basemap, plugins, and selections.
The dashboard decides when to release (minimized, off screen); map-sdk only makes it safe and
lossless. `map.destroy()` ends the context for good.

**Basemaps.** Basemap switching and the fallback when a style fails to load (monitor-map's
`mapStyleState`) move into the context. Basemap style ids are config with defaults matching
today's live map (MapTiler Streets v4, with the same excluded label layers). The picker menu
stays in monitor-map.

**Style changes are the core's job, not the plugins'.** The core calls a plugin's `setup` only
when a style is loaded, and after a basemap change it re-runs every plugin's teardown and setup.
Plugins never check a "style loading" flag. This replaces monitor-map's `styleLoading` and
`whenIconsLoad` rules, which are a common source of bugs today.

### Plugins

A plugin is a factory returning a `MapPlugin`. This refines the interface sketched in
`ARCHITECTURE.md`:

```ts
interface MapPlugin {
	id: string;
	setup(ctx: PluginContext): () => void; // add sources, layers, icons; returns teardown
	legend?(): LegendData | null; // data for the finished Legend component
	features?(): FeatureListItem[]; // what the feature list, summary, and keyboard path see
	selectable?: boolean; // whether this plugin's features can be selected
	displayOptions?: Snippet; // small per-plugin controls a host can place anywhere
}
```

- **`toSelection`** from the sketch becomes the selection model below: a plugin turns
  features into stable references.
- **`contextMenu`** from the sketch is left out of the plugin. The dashboard resolves menus
  synchronously inside the native `contextmenu` event, with each DOM scope adding to the
  payload, so map-sdk gives it what it needs to do that instead:
  - `map.featuresAt(point)`: a synchronous lookup returning the features under a screen point,
    each as `{ pluginId, ref, name }` (the map scope's `queryRenderedFeatures` step);
  - `map.featureForElement(element)`: the same for a feature-list row, so the Menu key and
    Shift+F10 on a focused row open the same feature menu by keyboard.

  The host builds the items from its own action registry. map-sdk has no menu model to keep in
  sync with the dashboard's.

- **`PluginContext`** gives a plugin the GL map, its own namespaced source and layer ids, the
  providers, click and hover registration, and icon registration, all torn down automatically
  with the plugin.

#### General plugins (by shape kind)

- **`pointsPlugin({ source, style, … })`**: anything with coordinates. Optional clustering,
  icons by category, and value-based color.
- **`shapesPlugin({ source, style, … })`**: polygons and lines, either plain (outline and fill)
  or filled by value through a scale (a choropleth).
- **`rasterPlugin`** is not built in milestone 1. The interfaces must not rule it out:
  `setup` can add any source type, and a legend can describe a continuous scale.

Each general plugin gives every dataset tooltips, hover and focus, selection, feature-list
items, legend data, and the color-plus-label rule, built once.

#### Data sources

Plugins never fetch for themselves. A data source is a reactive object (Svelte runes) that
exposes:

- `status`: `loading`, `ready`, `error` (with a retry), or `unavailable` (with a reason);
- `features`: a GeoJSON `FeatureCollection` where each feature carries a **stable reference**
  (below), a display name, and its value(s);
- `scale`: either a `ScaleRef` the plugin resolves through the metadata provider, or a `Scale`
  object passed in directly.

This generalizes monitor-map's `MonitorsDataSource`. The dashboard implements data sources over
its own data layer (date-range results, caching, polling). map-sdk's live stores implement them
for monitor-map and mobile.

#### Scales

**map-sdk uses the shared `Scale` and `Level` types from `@sjvair/sdk`**, defined by step 3's
second batch (sjvair.com `feature/metadata-scales`,
`docs/superpowers/specs/2026-11-03-metadata-scales-design.md`, in review on 2026-11-03):

```
Scale  { id, label, units, kind: "range" | "category", levels: Level[], source? }
Level  { key, label, color, opacity (0–1 or null), tier (0–4 or null), description, guidance,
         min/max (range; half-open, top max null) | value (category) }
```

One shape for every domain, so map-sdk, the dashboard, and the server agree, and the
dashboard's metadata provider can hand its scales over unchanged. Domain metas key their
scales by catalog entry-type id: `pm25`, `o3` (the new `scale` field on `monitors/meta/`),
`heat-score` (`calheatscore/meta/`), `aqi-forecast` and `burn-status` (`forecasts/meta/`),
`smoke-density` and `fire-frp` (`hms/meta/`). A `ScaleRef` is therefore
`{ dataset, entryType }`. Level `color` can be empty (an unknown burn status); the plugin then
draws a neutral fill with the label, never omits the feature.

The HMS colors and smoke opacities (light 0.2, medium 0.3, heavy 0.4) move from monitor-map's
code into `hms/meta/` unchanged, so today's look carries over. `opacity` was added to `Level` at
this session's request (2026-11-03) and is null on every level but smoke's; a plugin uses its
own default fill opacity when it's null. Fire FRP and burn status have `tier: null`.

Until a domain's meta is live, its preset is built and tested against fixtures in this shape,
and shows `unavailable` on a server without it. It never falls back to hardcoded values.

#### Ready for user files (prepared, not built)

Nothing in the data-source or scale contracts assumes a server id or a server scale: a data
source can be plain GeoJSON, and a host can pass its own `Scale`. Adding drag-and-drop GeoJSON
or CSV later means building an importer and a "pick a column and colors" step on top, with no
plugin changes. The importer is recorded in `DEFERRED.md`.

#### Milestone 1 presets

Thin wrappers over the general plugins, keeping today's live-map look:

| Preset                | Built on | Data and scale                                                                         | Selectable as                           |
| --------------------- | -------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| `monitorsPlugin`      | points   | monitors with a value per monitor; air-quality levels for the entry type               | `{ kind: "monitor", id }`               |
| `regionsPlugin`       | shapes   | region boundaries with a value each; air-quality levels                                | `{ kind: "region", type, code }`        |
| `hmsSmokePlugin`      | shapes   | smoke polygons; smoke-density scale                                                    | not selectable                          |
| `hmsFirePlugin`       | points   | fire points; fire-tier scale                                                           | not selectable                          |
| `calHeatScorePlugin`  | shapes   | ZIP boundaries with a score; CalHeatScore scale                                        | `{ kind: "region", type: "zip", code }` |
| `forecastZonesPlugin` | shapes   | forecast-zone boundaries (county and `custom` regions) with a category; forecast scale | `{ kind: "region", type, code }`        |

**The monitors preset keeps today's look and behavior:** marker shapes by monitor type,
level-colored fill, the current clustering (DBSCAN via `@turf/clusters-dbscan`) and cluster
rendering, and the current tooltips. The shape for each monitor type stays a presentation
mapping in code, with a fallback shape for unknown types. Monitor type labels come from
metadata.

**Ported from monitor-map, with these changes:**

- singletons → `PluginContext`;
- hardcoded colors, labels, and units (`colors.ts`, the legend's titles and "µg/m³", smoke and
  fire colors, the `150.5` fallback) → metadata scales;
- inline strings → message keys.

### Selection

- **Selection belongs to a plugin**, not the whole map, matching the dashboard's model where
  each layer has one `place` or one `selection`.
- **The host sets each plugin's mode:** `none`, `single`, or `multiple`.
- **The host owns the selection.** It passes the selected references in and receives a change
  event when the user changes them. The map shows whatever the host passes (place picker, undo,
  a saved document loading).
- **References are stable,** never the server's sqid: monitors by server id, regions by type
  plus official code. A plugin's selection uses the dashboard's `SpatialSelection` shape
  (`{ kind: "monitors" | "regions", ids }`, with region ids as `"type:code"` keys), so the
  dashboard stores it as-is. Helpers convert one id to and from the dashboard's `PlaceRef`
  monitor and region kinds, for single-place layers. Translating a code to the server's id for
  fetching is the data source's job.
- **Mouse** (the dashboard's decided method A): a click selects the feature, replacing the
  selection; shift-click (or ⌘/Ctrl-click) adds or removes it in `multiple` mode.
- **Touch** has no modifier key, so in `multiple` mode a tap adds or removes the feature, and
  the selection bar's Clear starts over (my call). In `single` mode a tap replaces.
- A click on empty map space does not clear. The dashboard shows the selection as removable
  chips in its widget title bar; that's the host's UI, not map-sdk's.
- **Selected features look different by more than color:** a thicker outline or ring plus a
  check mark.
- **Clicks are still reported** (`featureclick`, with plugin id and reference) whatever the
  selection mode, so monitor-map can open its detail panel.
- **Drawn shapes later** (`terra-draw`) add to the same per-plugin selection.

### Finished on-screen pieces

Svelte components, styled with Tailwind v4 utilities and shadcn-svelte's theme tokens
(`--primary`, `--popover`, `--border`, …), which both the dashboard and monitor-map already
define, so each host's colors and dark mode carry over. Each sits on a plain data function
(e.g. `legendData(plugin)`), so a host can draw its own instead.

- **Legend:** one section per plugin, built from its scale: a gradient for continuous scales,
  blocks for categorical ones, the same look as monitor-map's unified legend. Labels and ticks
  are always shown with the colors, and swatches get a contrasting outline (3:1).
- **Tooltip:** on hover, and on keyboard focus from the feature list. Name, value with unit,
  and the level label. Text on a level color uses `readableColor` (`color2k`).
- **Feature list:** the keyboard and screen-reader way into the map, and a "List" button for
  everyone else:
  - one tab stop, with the arrow keys moving between rows (roving focus) and typing jumping to
    a matching name;
  - shows only features in the current view, so zooming narrows it, and can be sorted by name
    or value;
  - each row reads name, value, unit, and level label (all from metadata), plus its selected
    state;
  - Enter selects (single), Space toggles (multiple), and the map highlights and pans to the
    row's feature;
  - renders only the rows on screen, so thousands of features stay fast.
- **Selection bar:** "N selected · Clear", shown when a plugin's selection is non-empty.
- **View summary:** one line, e.g. "142 monitors: 3 Unhealthy, 20 Moderate…" (message keys with
  plural forms). Announced politely after the view settles, not on every pan frame. Selection
  count changes are announced too.
- **Controls:** zoom and attribution, with dataset attribution from metadata where available.
- **The map itself** is one tab stop with MapLibre's keyboard pan and zoom. `cooperativeGestures`
  is a `MapView` option (the dashboard turns it on).

Every interactive element is keyboard reachable, has a visible focus style and an accessible
name from a message key, and respects `prefers-reduced-motion` (no animated pan when set).

### Providers and their defaults

All three are optional. The dashboard passes all three; monitor-map and mobile pass none.

- **`MetadataProvider`:** resolves a `ScaleRef` to a `Scale`, and gives entry-type labels and
  units and monitor-type labels. The default fetches through `@sjvair/sdk` (`getMonitorsMeta`,
  `getDatasetCatalog`, and step 3's scale metas), caches per provider instance, shares one
  in-flight request between callers, and forgets failures so the next call retries (the pattern
  in the dashboard's `metadata.ts`). It never rejects except on abort; missing data is
  `"unavailable"`.
- **`MessageProvider`:** `(key, params) → string`. The default holds map-sdk's English messages.
  Keys are namespaced (`mapsdk_…`) so a host can supply them from Paraglide. A message catalog
  file with English defaults ships with the package, so the dashboard can add the keys to its
  Paraglide project.
- **`FormatProvider`:** numbers, dates, and times. The default uses `Intl` with `en-US` and
  America/Los_Angeles, plus a "PT" label only when the device is in another zone (the
  dashboard's rule).

### `createMonitorsStore()` (live)

An app-level store (in `/stores`) that replaces the `monitorsManager` singleton:

- the monitor list, current readings for one entry type, and metadata levels;
- polling every 2 minutes (pause and resume), and a refetch when the entry type changes;
- a shared, re-entrant `init` with the same rules as today (overlapping calls share a run, an
  explicit entry type wins, a rejection clears for retry, `autoUpdate: false` loads without
  polling);
- request cancelling with the same semantics (superseded calls resolve quietly, a caller's
  aborted signal rejects);
- a `dataSource` view that `monitorsPlugin` accepts directly.

One store can feed any number of maps and screens, and works with no map at all, so monitor-map
5.0 can create one and keep exporting it as `monitorsManager` from `/core` for mobile. Entry
types are not hardcoded: the store accepts any entry type, and the available-pollutants list
comes from metadata.

It's in this session's brief but not on the dashboard's critical path, so it is **scheduled
last** in the plan, after everything the dashboard needs. It stays in milestone 1 unless the
user decides to move it to milestone 2 (my call).

### Demo page

A Vite dev page in the repo (`npm run dev`), not shipped in the package:

- runs against the local sjvair.com stack at `http://localhost:8000`, with `/api/` proxied;
- MapTiler key from the git-ignored `.env` (`VITE_MAPTILER_KEY`), never committed or printed;
- **two maps side by side.** One is fed like the dashboard: a small date-range data source over
  `@sjvair/sdk` summaries, with every milestone 1 preset toggleable. The other uses the live
  `createMonitorsStore()`;
- controls for selection mode, an external "selection" editor to show the two-way sync, and a
  "hide map" toggle to show the WebGL release and rebuild;
- the Playwright and axe tests run against it.

A local DB needs `podman exec sjvaircom_web_1 python manage.py loaddata
default-calibrations.yaml` before PM2.5 shows; the README says so.

## Dependencies on other work

The sjvair.com session (step 3) owns sdk-js and the server metadata. What map-sdk needs, and
where it stands:

| Needed                                                                                                                | Where                                       | Waits on it                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| Shared `Scale`/`Level` types; `tier` and `scale` on AQ levels                                                         | step 3 batch 2, spec 1 (in review)          | real data for every preset (fixtures until then) |
| `hms/meta/` (smoke density, fire FRP)                                                                                 | spec 1                                      | HMS presets on real data                         |
| `calheatscore/meta/` and the `calheatscore/` wrapper                                                                  | spec 1                                      | `calHeatScorePlugin` on real data                |
| `forecasts/meta/` (AQI scale, zone list) and wrapper                                                                  | spec 1                                      | `forecastZonesPlugin` on real data               |
| `regions/geojson/` wrapper (type required, regions by code, several at once; keeps `within`/`slug`/`name`/`simplify`) | spec 1 (moved in at this session's request) | boundaries for region fill, ZIPs, and zones      |
| Optional `opacity` on `Level` (smoke)                                                                                 | spec 1 (added at this session's request)    | today's exact smoke look                         |
| `@sjvair/sdk` 4.8.0 released                                                                                          | after #293 reaches production               | publishing a map-sdk release that needs 4.8 APIs |

**Build order:** core, the general plugins, monitors, and region fill first, then the other
presets against fixtures, switching each to real data as its meta lands. The server session
will say when an `@sjvair/sdk` beta with these types is out; map-sdk pins that beta, as the
dashboard pins its betas. Spec 1 is still waiting on the user's approval, so any of this can
change.

**Milestone 1 is done** when all six presets run on real server data on the demo page. Early
`0.x` releases (each with the user's yes) can go out before that, once monitors and region fill
work.

## Tooling, CI, and releases

- **Stack:** Node 26 (as monitor-map), Svelte 5, TypeScript, Vite 8, `svelte-package`,
  Tailwind v4, `@maptiler/sdk` (as monitor-map; BSD-3-Clause, built on MapLibre), `@turf/*`,
  `color2k`.
- **Tests:** Vitest for pure modules and rune modules (scales, selection, store rules,
  feature-list ordering, the plugin lifecycle against a fake map), Vitest browser mode for
  components, and Playwright with `@axe-core/playwright` on the demo page (against stubbed API
  responses in CI, the local stack by hand).
- **CI (GitHub Actions):** lint, type check, tests, the bundle check for `/stores` and `/data`,
  and a license check over production dependencies (same allowed list as the dashboard).
- **Registry: npm**, as `@sjvair/map-sdk`, the same as monitor-map. (My call: a Svelte library
  ships uncompiled `.svelte` files, and JSR's npm compatibility layer is built for TypeScript
  modules, not Svelte components.)
- **Versions:** `0.x` until 1.0; breaking changes bump the minor version. A release workflow
  like monitor-map's (triggered by a GitHub Release). **Every publish and every tag needs the
  user's explicit yes for that release.**
- **Repo:** `SJVAir/map-sdk`, public. A `CLAUDE.md` and `README.md` in the style of
  monitor-map's. No pushes without asking.

## Decisions made in this spec

Recorded so the dashboard docs can be updated:

1. **Two milestones.** Milestone 1 covers what the dashboard needs. monitor-map parity is a
   later map-sdk spec, started with the 5.0 rebuild. (The user: the dashboard is the priority,
   and the live map and mobile keep shipping from the current monitor-map until then.)
2. **General plugins by shape kind, plus thin dataset presets** (the user wanted any dataset
   with coordinates or shapes to be placeable).
3. **Milestone 1 presets:** monitors, region fill, HMS smoke, HMS fire, CalHeatScore ZIPs, and
   forecast zones (the user added the last two). CalHeatScore ZIPs and forecast zones move out
   of `DEFERRED.md` → "Map plugins".
4. **Prepared for user GeoJSON and CSV, not built** (the user).
5. **Finished on-screen pieces ship with map-sdk,** over plain data functions (the user).
6. **Keyboard and screen-reader access through a feature list**, not one tab stop per marker
   (the user agreed after asking how it scales to thousands of features).
7. **Per-plugin, host-owned multi-select** with stable references (the user wants several
   monitors selectable to compare).
8. **The dashboard feeds date-range data in; map-sdk's stores are live only** (the user).
9. **Today's live-map look is kept** (the user).
10. **A demo page against the local stack** is the check before the dashboard builds on it (the
    user).
11. **npm, not JSR** (my call, above).
12. **`contextMenu` leaves the plugin interface;** map-sdk offers synchronous `featuresAt` and
    `featureForElement` lookups and the host builds the menu (my call, to fit the dashboard's
    synchronous menu scopes).
13. **Selection gestures follow the dashboard's method A** (click selects, shift-click adds),
    with tap-to-toggle on touch (my call), and selections use the dashboard's
    `SpatialSelection` shape.
14. **`MapContext` outlives the GL map,** so releasing WebGL is lossless (my call).
15. **`@sjvair/sdk` is a peer dependency** (my call, to avoid a nested copy that ignores the
    host's `setOrigin`).
16. **"Shared date-range helper home" (open in `DEFERRED.md`): not map-sdk.** map-sdk handles no
    date ranges. sdk-js already has Pacific day helpers (`startOfPacificDay`, `addPacificDays`),
    and the dashboard has its `format` module. Whether monitor-map's `DataChart` moves to a
    shared helper is decided in the monitor-map 5.0 plan (my call).

## Deferrals to record in data-dashboard `DEFERRED.md`

Each with why and a revisit trigger, in the same docs PR:

- **map-sdk milestone 2 (monitor-map parity):** collocation sites, EV stations, live stores
  beyond monitors. Revisit when the monitor-map 5.0 rebuild starts. EV stations need the NREL
  key moved into injected config, and the hardcoded ZIP list and labels need a proper home.
- **Wind layer license:** `@maptiler/weather` is proprietary, so map-sdk can't depend on it.
  Revisit in the milestone 2 spec: monitor-map keeps wind as its own plugin outside map-sdk, or
  wind moves to an open data source.
- **User GeoJSON and CSV import:** the contracts are ready; the importer and the "pick a column
  and colors" step aren't built. Revisit when users ask to map their own data.
- **Raster plugin:** interfaces allow it, nothing built. Revisit with TEMPO or wind.
- **Arrow-key jump to the nearest feature on the map:** the feature list covers keyboard needs.
  Revisit if keyboard users find the list too indirect.

## Docs updates in data-dashboard

From a worktree (`.worktrees/docs-map-sdk`, branch `docs-map-sdk-<topic>` off `origin/main`),
never the main checkout: this track's row in `TODO.md` → "Start here", `TODO.md` → "Release 1,
step 5", `ROADMAP.md` item 5, `ARCHITECTURE.md` → "Map SDK" (the refinements above), and the new
`DEFERRED.md` entries plus moving CalHeatScore ZIPs and forecast zones out of "Map plugins" and
closing "Shared date-range helper home". One docs PR into `main`; merging needs the user's yes.

## Left to the builder

- Exact type and field names (`FeatureListItem`, `LegendData`, events, options), using
  `@sjvair/sdk`'s `Scale` and `Level` and the dashboard's `SpatialSelection` and `PlaceRef`.
- File layout, internal module boundaries, and how ported monitor-map code is reorganized.
- Clustering and feature-list performance details (virtualization method), within "thousands of
  features stay fast".
- Message key names and the catalog file format, as long as the dashboard can import it into
  Paraglide.
- Test stubs for the API in CI.
