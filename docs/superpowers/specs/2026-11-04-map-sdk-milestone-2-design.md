# `@sjvair/map-sdk`: milestone 2 design (monitor-map parity)

Date: 2026-11-04. Status: **approved by the user 2026-11-04.**
Release 1, step 5 (data-dashboard `ROADMAP.md` item 5, `TODO.md` → "Release 1, step 5").
Milestone 1: `2026-11-03-map-sdk-design.md` (built and merged, #1). This spec adds to it; where
the two disagree, this one wins.

## Intent

monitor-map 5.0, the live map on sjvair.com and the mobile app's map, is rebuilt on map-sdk.
**The user's goal (2026-11-04): monitor-map 5.0 should "pretty much function and look the same
as it currently does".** map-sdk is the tool that can build that exact map, and it must still
build other custom maps, such as the dashboard's Map widget.

Why now: the user decided (2026-11-04) that the updated mobile app and sjvair.com `develop` are
released on the same day, and that before then map-sdk is on the latest `@sjvair/sdk` 5.0 beta,
monitor-map is rebuilt on map-sdk as 5.0, and mobile is on that monitor-map. So this milestone is
on the go-live path. It doesn't depend on the dashboard and runs alongside step 4.

map-sdk moved to `@sjvair/sdk` 5.0.0-beta.2 in #2 (merged 2026-11-04; peer range
`^5.0.0-beta.2`, the user's call), so this milestone builds on 5.0.

## How this spec was made

A side-by-side check of monitor-map 4.3.0 against map-sdk `main` (2026-11-04): the code of both,
and both running on the local stack. Today's monitor markers and clusters already look the same
on both. Every remaining difference falls into one of four groups:

1. **map-sdk adds it** (this milestone's work, "What map-sdk adds" below).
2. **monitor-map builds it on top** with map-sdk's API (the monitor-map 5.0 plan's work; listed
   below so that plan can check nothing is missing).
3. **map-sdk keeps its own behavior** because it fixes a bug or is there for accessibility.
4. **It's an option**, map-sdk's look by default, and monitor-map sets it to today's look.

## Decisions

The user's decisions, 2026-11-04:

- **The parity rule.** Match today's map exactly, except where map-sdk's version fixes a bug or
  is there for accessibility (those stay as map-sdk does them). Where map-sdk follows the
  dashboard's style, that becomes an option, which monitor-map sets to today's look.
- **Inactive monitors are `#969696`, and inside monitors have a black outline, on every map**,
  the dashboard included. These are map-sdk's defaults, an exception to milestone 1's rule that
  components take colors from theme tokens. (Milestone 1 used `--muted-foreground` and
  `--foreground`; the black outline then turned light on a dark page.)
- **Wind stays monitor-map's own layer**, built with `@maptiler/weather` as today. map-sdk can't
  depend on that package (it's proprietary), so map-sdk only adds a way for a layer defined
  outside map-sdk to sit in its place in the draw order. Wind from open data is deferred.
- **EV chargers stay in monitor-map** for now: the NREL fetch, the key, the ZIP list, and the
  label maps. The 5 mountain counties (Calaveras, Tuolumne, Mariposa, Mono, Inyo) stay in the
  charger area on purpose. map-sdk gets an EV layer only once the server has a proper EV
  integration (deferred).
- **The split between the two packages:** layers built on SJVAir server data (through
  `@sjvair/sdk`) belong in map-sdk; layers built on outside services (wind, EV chargers) stay
  in monitor-map.
- **Collocation sites move into map-sdk**, as a preset, with the crosshair color as a built-in
  default like the monitor colors.
- **Credits work like today's map:** the map engine's own credits control. A full line on wide
  maps; on maps 640px wide or narrower it starts open and folds into an "ⓘ" button on the first
  drag. "© MapTiler" and "© OpenStreetMap contributors" always stay. Data-source credits from
  metadata go into the same line (they're blank for now; the slot stays). map-sdk's hand-drawn
  MapTiler logo goes; MapTiler's own setting shows the logo only when the key's plan requires
  it. (Raised by the user through the coordinator, 2026-11-04.)

## Goals

1. monitor-map 5.0 can be built on map-sdk to look and behave like monitor-map 4.3.0, under the
   parity rule above.
2. Nothing map-sdk adds is monitor-map-only: every addition is a general option, and the
   dashboard's Map widget keeps working unchanged unless it opts in. `SpatialSelection` keeps
   its shape: the dashboard's place picker relies on it (the user, 2026-11-04), so any change
   goes to the coordinator and the step 4 session first.
3. The mobile app's compatibility surface stays buildable: monitor-map 5.0's `/core` (an
   app-wide monitors store with no map, `provideMonitorMapRouter`) and `/routes`.
4. map-sdk stops reading the monitors meta's legacy `levels` once the SDK drops it.

## Non-goals

- The monitor-map 5.0 rebuild itself and the mobile migration (their own plans later).
- The dashboard's Map widget (data-dashboard, after step 4).
- Wind and EV chargers inside map-sdk (see Decisions).
- Drawn shapes (`terra-draw`), rasters, and the other deferred dataset plugins.
- monitor-map's detail panel (chart, temperature, widget code, subscriptions), options toolbar,
  search box, load screen, and routing. These stay in monitor-map.
- Publishing. Each map-sdk release needs the user's yes.

## Anti-goals: it fails if…

- a visitor to sjvair.com or the app notices the map changed, other than the bug fixes and
  accessibility additions this spec lists;
- the dashboard's map changes without opting in (except the two monitor colors, the user's
  decision);
- map-sdk gains a dependency outside the license policy, or calls a non-SJVAir service;
- the light entries (`./data`, `./stores`) reach the map engine;
- anything becomes module-global, so two maps on a page interfere.

## What map-sdk adds

Each item is general: the dashboard can use it too. "Today" means monitor-map 4.3.0.

### Map and camera

1. **Moving the camera.** `MapContext` can fly or ease to a point with a zoom (or a minimum
   zoom), and fit bounds. Today a monitor click eases to at least zoom 12, a monitor search
   result flies to zoom 12, and an address result to zoom 16. Respects reduced motion like
   `focusFeature`. Today only `focusFeature` exists, and it only pans.
2. **Reaching the GL map from the host.** A documented, reactive way to get the live MapTiler
   `Map` while it exists (it's replaced when `active` toggles), for things map-sdk doesn't wrap:
   the search pin (`Marker`) and the EV station popup (`Popup`). Documented as an escape
   hatch: the host must not add sources or layers through it (plugins do that).
3. **A "map is ready" signal.** Reactive, true once the style has loaded and the map has gone
   idle for the first time. Today's load screen waits for this. (`attached` is true as soon as
   the GL map exists, which is too early.)
4. **Globe projection and the space background**, as `MapConfig` options, off by default.
   monitor-map turns both on (globe, the Milky Way preset), as today. The dashboard keeps the
   flat map: the globe under-zooms large counties (data-dashboard `DEFERRED.md`).
5. **Choosing which built-in pieces `MapView` shows.** The selection bar can be left out; the
   map controls can be left out; and a map can use the map engine's own controls instead of
   map-sdk's: zoom with the compass (resets the bearing), and locate-me (the location dot and
   accuracy circle). Today's map uses exactly those, so monitor-map uses them in 5.0 (see "My
   calls"). map-sdk's own `MapControls` stay the default and gain nothing. The
   List button already has `featureList={false}`; it stays on by default (accessibility), and
   monitor-map keeps it, placed so it doesn't sit under the options toolbar.
6. **Credits** as in Decisions: the map engine's attribution control replaces the always-open
   credits row in `MapControls`, data credits go into it, and the logo follows MapTiler's own
   setting.
7. **Pointer cursor** over interactive features (today: over monitors, collocations, and EV).
   map-sdk sets no cursor today.
8. **Hover priority.** A plugin can win the hover tooltip over plugins drawn above it. Today
   collocation sites draw under monitors but win the tooltip. (Alternative the plan may choose:
   draw collocations above monitors, if that looks the same.)
9. **Layers defined outside map-sdk.** A host plugin can add a MapLibre custom layer (such as
   `@maptiler/weather`'s `WindLayer`) through its `PluginContext`, in its draw-order slot, and
   it's removed and re-added on restyle like any other layer. Today `addLayer` copies the spec,
   which drops a custom layer's methods. map-sdk tests this with a stand-in custom layer, never
   with `@maptiler/weather`.

### Monitors

10. **Fixed colors:** inactive monitors `#969696`, the inside-monitor outline black (Decisions).
11. **The selected-monitor look as an option.** Default: the ring and check mark (the
    dashboard's). Option: today's look, the selected icon at 1.3× with no ring. The selection
    bar is hidden through item 5.
12. **Tooltip behavior as an option.** Default: map-sdk's tooltip, pinned to its feature. Option:
    today's, which follows the cursor and closes when the map zooms.
13. **The "(N avg)" note** in the monitor tooltip, from the monitor type's `expected_interval` in
    the monitors meta, which is where today's map reads it (e.g. "1 hour" for AirNow, "2 min"
    for PurpleAir). This closes the "(1-hour avg)" entry in `DEFERRED.md` (see "My calls").
14. **The monitors store's metadata is public** (read-only), so monitor-map 5.0's `/core` can
    give mobile what `monitorsManager.meta` gives it today. Mobile also reads `list` as an
    array; the `/core` shim can derive it from `monitors`, so map-sdk needn't add it. Mobile's
    alert and subscription screens read `levels` from that meta today; moving them to the
    meta's `scale` is the mobile migration's job (data-dashboard `DEFERRED.md`, the deploy
    entry), not map-sdk's. map-sdk adds no levels API.

### HMS smoke and fire

15. **Smoke outline in the plume's own color** as an option on `shapesPlugin` (outline:
    theme / level color / none). Today the edge is the density color at the fill's opacity;
    map-sdk draws a 1px `--foreground` line. `hmsSmokePlugin` uses today's look by default.
16. **Fire groups below zoom 10, single hotspots from zoom 10**, switching live while zooming as
    today. A general per-plugin (or per-source) zoom range is enough: monitor-map adds two fire
    plugins, groups up to 10 and hotspots from 10. Export the null-FRP drop and coordinate
    dedupe (`fire-groups.ts`) so the hotspot list is cleaned the same way as the groups.
17. **Fire legend as blocks** ("<10", "10–49", …) as a legend option for range scales; today's
    fire legend is blocks, map-sdk's is a gradient.
18. **Legend section order** as an option (top-first). Today: pollutant, then fire, then smoke.
    map-sdk lists bottom-first (smoke, fire, monitors).

### Collocation sites (new preset)

19. **`collocationSitesPlugin`**: each site drawn at its reference monitor with the reference
    monitor's shape and level color, wrapped in today's crosshair (`#4A5FC6`, a built-in default).
    Its value and scale follow the reference monitor's current reading, so it joins the
    monitors store's data (by `reference_id`). Hover shows today's tooltip: the reference
    monitor's and the collocated monitor's readings side by side. Not selectable by default.
    Whether it's offered (today: only with monitors on and PM2.5) stays the host's rule.
20. **Live stores for today's data**, in `./stores` with no map engine: collocation sites, HMS
    smoke, and HMS fire. Each loads once, like today (no polling), exposes a `dataSource`, and
    follows `createMonitorsStore`'s init, status, retry, and abort rules.

### Smaller additions

21. **Exported marker shapes** (circle, square, triangle SVG helpers), so a host draws matching
    icons (today's options menu uses them; EV and collocation icons build on them).
22. **The legacy `levels` fallback goes** (`scaleFromLegacyLevels` in `src/lib/data/scale.ts`, its
    use in `metadata.ts`, and their tests) when map-sdk pins the SDK beta that drops `levels`
    from the monitors meta. Until that beta exists, this item waits; the plan puts it last and
    the pin bump with it. sdk-js (session `sdk-js-8c`) says it's a later 5.0 beta. It must land
    before go-live: the server drops `levels` in `develop`, which is what ships.
23. **README fix:** it says `MapView` has basemap controls; it doesn't. While editing, keep the
    README token list, examples, and `tests/unit/readme-examples.test.ts` in step.

## What stays map-sdk's (fixes and accessibility)

Under the parity rule these stay as map-sdk does them, even though they differ from today:

- **Fixes:** a cluster's average counts only monitors with a reading (today a missing reading
  counts as 0); a monitor with no reading keeps its own shape in the neutral color (today it
  becomes a gray square); a reading exactly on a level boundary follows the server's scale,
  half-open `[min, max)` (today: whole numbers, both ends included).
- **Accessibility:** the legend's level labels and outlined swatches; the List button and
  keyboard feature list; the map's focus outline; zoom-button tips; tooltips on smoke and fire
  (today they have none); and readable text on cluster colors (`readableColor`; today's red
  clusters have white text, map-sdk's black).

## What monitor-map builds on top

For the monitor-map 5.0 plan to check against; map-sdk needs nothing more for these:

- Filters by monitor type, inactive, and inside (inactive and inside off by default): a
  `DataSource` wrapping the store's, filtering `features`; cluster averages follow the filter.
- Turning layers on and off (Fire & Smoke together, collocations, wind, EV, `?pollutant=none`),
  the clustering switch, and the pollutant switch: add and remove plugins with `before`, and
  re-pass selections.
- The basemap and theme menus, and Reset: `BasemapConfig` with every style variant, and
  `basemap.select`. Today's map shows the basemap's shops, food, tourism, and transport places
  (its code to hide them never runs), so monitor-map passes `excludedLayers: []`.
- Address search: MapTiler geocoding with the map's key, browser location for proximity, and
  the pin (item 2).
- Wind (item 9), EV chargers (fetch, two charging levels, clusters, icons, and the click popup
  through `featureclick` and item 2), collocations' availability rule, the folding "Legend"
  card around map-sdk's `Legend`, the load screen (item 3), the detail panel, routes, and the
  `/core` shim (item 14).
- The panel opening and closing needs no `resize()`: MapLibre tracks its container's size.

## My calls

Made by me, not the user; flag any you disagree with:

- Readings exactly on a level boundary follow the server's levels (counted as a fix).
- monitor-map keeps the map engine's own zoom, compass, and locate-me buttons, as today, rather
  than map-sdk adding a compass and locate-me to its own themed controls (item 5).
- map-sdk keeps hiding the basemap's POI layers by default; monitor-map turns that off.
- Live stores for collocation sites and HMS (item 20), so monitor-map only connects them.
- The "(N avg)" note uses the monitor type's `expected_interval`, matching today. Milestone 1's
  build deferred the note because the server gives no averaging window per entry type;
  `expected_interval` is how often a monitor type reports, which is what today's map shows.
- Optional, only if the plan finds it visible: per-type layer stacking in `pointsPlugin`
  (today each monitor type draws cluster, average, then points; map-sdk draws all clusters,
  then all points).
- While in the fire preset, look at the "hms-fire icon could not be loaded" warning
  (`DEFERRED.md`).

## Dependencies on other repos

- **`@sjvair/sdk`:** nothing new. `getCollocationSites`, `getHMSSmoke`/`getHMSFire`, and the
  monitors meta's `expected_interval` exist in 5.0.0-beta.2. The `levels` removal beta (item 22)
  is sdk-js's.
- **sjvair.com:** nothing new. The HMS smoke and fire scales map-sdk reads are on `develop`
  only, which ships with this release.
- **monitor-map** needs a published map-sdk `0.x` to depend on. Development links locally;
  every publish needs the user's yes, each time.

## Deferrals (added to data-dashboard `DEFERRED.md` with this spec)

- **Wind from open data** (e.g. NOAA GFS winds processed by the server, drawn with an
  open-source wind layer) as a map-sdk plugin. Revisit if the dashboard wants wind, or to drop
  `@maptiler/weather`. Replaces the "Wind layer license" entry, now decided.
- **Server EV integration, then a map-sdk EV layer.** Chargers come from NREL in monitor-map;
  the server could own the station data (or at least the ZIP list, which would need ZIP regions
  for the 5 mountain counties). Revisit when the server integrates EV chargers.
- **monitor-map's EV ZIP list cleanup and the NREL key in config** are monitor-map 5.0 plan items
  (the list has duplicates, and some Inyo/Mono ZIPs are filed under San Joaquin), noted on the
  milestone 2 entry, not new deferrals.
- Update the "map-sdk milestone 2" entry (now this spec), "Globe projection" (now item 4), and
  "(1-hour avg)" (now item 13).

## Testing

As milestone 1: unit, client, and browser tests for each addition; the bundle check (the new
stores stay off the map engine); the license check; the demo page shows the new presets and
options; e2e on Chromium and Firefox locally, WebKit in CI. Visual parity is judged by the user
against today's map on the local stack, side by side, before the plan is done.

## Left to the builder

API names and shapes; file layout; how options are grouped; how the ready signal and the GL
escape hatch are exposed; whether hover priority or draw order solves collocations; the order
of work, as long as items 1–3, 5, 9 and 14 (what the rebuild can't start without) come early.
