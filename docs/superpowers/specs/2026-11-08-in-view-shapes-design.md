# Shapes that cover the view count as in view — design

Date: 2026-11-08. Branch `fix/in-view-shapes` from `origin/main` (6f165bf, after `0.1.0-beta.4`).
Ships as `0.1.0-beta.5`.

## Why

Session `monitor-map-72` found this on 2026-11-08, and the coordinator confirmed it in the code.
`inView(items, bounds)` (`src/lib/ui/feature-list.ts`) keeps an item only if its single `lngLat`
is inside the view bounds. For shapes, `lngLat` is `labelPoint(geometry)`
(`src/lib/plugins/shapes.svelte.ts`), the centroid of the largest outer ring. Both the feature list
(`FeatureList.svelte`) and the live summary (`ViewSummary.svelte`) use `inView`.

That day's local HMS smoke plume (light, GOES-WEST, lat 26.3–38.8, lng -124.2 to -118.4) covers
the whole default view, but its centroid is off Baja (about -121.2, 32.5). So the list has no
smoke row and the summary says "0 Smoke". Keyboard and screen-reader users can't reach a plume
that fills the screen. Any large shape whose label point is off-screen has the same problem
(a big region in a choropleth, for example).

A second problem shows up once the row exists. Focusing a row calls `MapContext.focusFeature`,
which eases the camera to center the item's `lngLat`. Arrowing onto the smoke row would slide the
map down to Baja.

## Goals

1. A shape is in view when its geometry overlaps the view, not only when its label point is in
   the view. This applies to the list and the summary.
2. Focusing the row of a shape that overlaps the view, but whose label point is off-screen, does
   not move the camera. Its pinned tooltip appears at a point of the shape inside the view. Hovering
   such a shape in pinned mode places its tooltip the same way.
3. Moving the map stays cheap with many complex polygons. A shape's bounding box is computed once
   per data load, not on every move.

## Non-goals and anti-goals

- Points keep their current behavior exactly.
- Shapes whose label point is on screen keep today's focus behavior (pan to center the label
  point).
- The list's sort order doesn't change. It sorts by name or value, not by position, so a shape
  that overlaps the view sorts like any other row.
- No antimeridian handling, the same as points today (see "Deferred").
- No new screen-reader announcement that the map didn't move. The tooltip and the row's own label
  already describe the shape.
- Anti-goal: the list must not show shapes you can't see. A long diagonal plume whose bounding box
  clips a corner of the view, while its smoke doesn't, is **not** in view. This is why the test is
  a true intersection, not a bbox check.

## 1. The in-view test (user, 2026-11-08)

An item with a shape is in view when the shape intersects the view rectangle (`Bounds`, edges
included, matching points). The test:

1. **Bbox pre-check.** If the shape's bbox doesn't overlap the view, it's out. Most shapes stop
   here.
2. **Exact test** for shapes that pass, per geometry type:
   - **Polygon** (outer ring plus holes): in view if any vertex of any ring is inside the
     rectangle, or any rectangle corner is inside the polygon (inside the outer ring and outside
     every hole), or any ring edge crosses a rectangle edge.
   - **Holes count.** If the whole view sits inside a hole, the shape is not in view. The test
     above gets this right: no ring vertex is in the view, the corners fall in the hole, and no
     edges cross.
   - **MultiPolygon:** in view if any of its polygons is.
   - **LineString / MultiLineString:** in view if any vertex is inside the rectangle, or any
     segment crosses a rectangle edge.
   - **Point:** inside the rectangle (the same as today).
   - Other geometry types (GeometryCollection, MultiPoint): fall back to the label point, as
     today. My call: `shapesPlugin` doesn't produce them from its supported data.
3. **No geometry** (every point plugin, and any host plugin that doesn't supply one): the current
   `lngLat` test, unchanged.

Coordinates are treated as planar lng/lat, the same as `labelPoint`. Over the Valley's span the
difference from the map's Mercator drawing is negligible (my call).

## 2. Where the shape comes from (API)

`FeatureListItem` (public, `src/lib/core/plugin.ts`) gains two optional fields (my call on the
shape of the API):

- `geometry?: Geometry`: the item's GeoJSON geometry. When given, it decides in-view (section 1)
  and the focus anchor (section 3).
- `bbox?: [west, south, east, north]`: the geometry's bounding box. Optional. When missing,
  `inView` computes it from `geometry`. Plugins that list many shapes should supply it, so it
  isn't recomputed on every move.

`shapesPlugin` sets both. It computes `labelPoint` and the bbox once per feature object, in a
`WeakMap` owned by the plugin instance (never module-global, per the "two maps share nothing"
rule). Its `features()` is called on every move and rebuilds the items, but the geometry work then
happens once per data load. Presets built on `shapesPlugin` (regions, CalHeatScore, forecast
zones, HMS smoke) get this for free.

`hmsFirePlugin`'s groups and the other points-based presets don't change.

New exported helpers (from `.`, next to the other UI helpers; the builder picks the module):
`geometryBbox(geometry)` and `intersectsBounds(item, bounds)`, used by `inView`. Exporting them is
my call, so host plugins can precompute `bbox` the same way.

## 3. Focus and the pinned tooltip (user, 2026-11-08)

When `focusFeature(refKey, pluginId)` finds the item:

- **The item has a geometry, its `lngLat` is outside the current bounds, and its geometry
  intersects them:** the camera **does not move**. The focus anchor is a point of the shape inside
  the view:
  1. The center of the part of the view the list panel leaves clear (the same point
     `focusFeature`'s ease targets today through `#listOffsetX`), if the shape contains it. This is
     the common case for a plume or a big region, and the tooltip lands in the same easy-to-find
     spot every time.
  2. Otherwise, a point well inside the visible part of the shape: clip the shape to the view
     rectangle, take the clipped polygon with the largest area, and use the midpoint of the widest
     interior span of a horizontal line through the middle of its clipped bbox. Holes count, so
     the point is never in a hole. For lines, use the midpoint of the longest visible piece. The
     builder may use another method that meets the same bar: inside the shape, inside the view,
     not on an edge.
  3. If neither yields a point (degenerate geometry), the label point, as today.
- **Otherwise** (points, shapes with their label point on screen, no bounds yet): today's behavior,
  ease to center `lngLat`. The anchor is `lngLat`.

Details (my calls, from the review):

- **Which view.** The rule checks the live view at the moment of focus (`gl.getBounds()`), not
  the settled `#bounds` and not the list's frozen bounds. If an earlier focus's ease is still
  running (a user arrows quickly from a monitor row onto the plume row), the no-move branch first
  stops it by easing to the current center with `duration: 0`, so "doesn't move" means the camera
  stays where it is now. That stop uses existing `GlMapLike` methods only. No interface changes.
- **The clear part of the view.** The anchor (steps 1 and 2) is found in the part of the view the
  list panel leaves clear: the live bounds with the panel's share cut off its side. Longitude is
  linear in x on a Mercator map, so `west + (inset / width) × (east − west)` is exact without
  bearing and close enough with it. No `unproject` is needed. The in-view test for rows still uses
  the whole view.
- **A shape that touches the view only under the panel** has no point in the clear part. Focusing
  it eases to center a point of the shape found in the whole view (step 2 against the whole view),
  which moves the map only a little. It doesn't ease to the label point.
- **A shape that no longer touches the live view** (it was listed by the frozen bounds, and earlier
  focus pans moved the map off it): eases to center a point of the shape found in the last settled
  bounds (`map.bounds`) if the shape touches them, else its label point, as today.

`MapContext` gains a reactive, read-only `focusedAnchor: [number, number] | null` (my call on the
name). It's set with `focusedKey`, computed once at focus time (so the tooltip stays fixed on the
map if the user then pans), and cleared when focus clears or the map is destroyed.

`MapTooltip.svelte` anchors at `map.focusedAnchor` when the item it shows is the focused one (same
refKey and plugin). Otherwise it anchors as today. The existing clamp that keeps the tooltip inside
the container stays.

**Hover (user, 2026-11-08: include it).** In `tooltip: "pinned"` mode, a hovered shape whose label
point is off-screen pins its tooltip by the same anchor rule (steps 1 to 3, in the clear part of
the live view). It never moves the camera. An example: zoomed in on Fresno, hovering Fresno County.
Today that tooltip is pushed to the map's edge. The anchor is computed once when the hovered item
changes, not on every pointer move, so the tooltip doesn't hop. Hovered points, and shapes with
their label point on screen, anchor as today. `"pointer"` mode is unchanged (it anchors at the
pointer). Smoke takes no hover, so this is mostly regions and other choropleth shapes. Builder's
call: where the hover anchor is computed (a `MapContext` method, or `MapTooltip` with access to the
live view). Any new `MapContext` member is optional to use and changes no existing signature.

The list's frozen bounds (`FeatureList.svelte`'s `frozen`) are unchanged. They keep the rows still
while the listbox has focus, and they already work with a camera that doesn't move.

## 4. Tests

- **Unit** (`tests/unit/ui/feature-list.test.ts`, or a new spec next to it):
  - A shape that covers the view, with its centroid outside it: in view.
  - A shape fully outside: not in view.
  - A shape that partly overlaps: in view.
  - A multipolygon with one part in view: in view. All parts outside: not in view.
  - A diagonal polygon whose bbox overlaps the view but whose area doesn't: not in view.
  - A view inside a hole: not in view.
  - A line that crosses the view with no vertex inside it: in view.
  - An item with no geometry: the label-point test, as today.
  - Touching edges: in view.
  - `geometryBbox` for each geometry type.
  - The focus anchor: the view center when the shape covers it; a point inside the shape and the
    view otherwise (a shape that doesn't cover the center, a shape with a hole over the center);
    the label point for a degenerate shape.
  - `shapesPlugin`'s items carry `geometry` and `bbox`, and the same feature object isn't
    measured twice (spy, or identity of the cached result).
- **Fixture:** today's plume. Copy the feature from monitor-map-72's saved response
  (`monitor-map/smoke-plume-2026-11-08.json`, the raw `GET /api/2.0/hms/smoke/` response, one
  plume) into a map-sdk fixture. Leave the original untracked in monitor-map; don't move or commit
  it there.
- **Browser** (`tests/browser/feature-list.browser.test.ts` or alongside it): a map whose view
  sits inside the covering plume, with its centroid off-screen. The list has a smoke row, the
  summary counts 1 smoke, focusing the row leaves the camera unchanged, and the pinned tooltip
  sits inside the map near its center. Arrowing from a point row onto the plume row while the
  point's ease runs leaves the camera where it stopped.
- **Browser, hover:** in pinned mode, hovering a shape whose label point is off-screen pins the
  tooltip inside the map at the anchor, not at the edge. Hovering a shape whose label point is on
  screen anchors at the label point, as today.
- **Existing specs** for points, focus panning, and the summary keep passing unchanged.

## 5. Docs

- README "Writing a plugin": document `geometry` and `bbox` on `FeatureListItem`, and the focus
  rule. Keep `tests/unit/readme-examples.test.ts` in step.
- README "Changes": a `0.1.0-beta.5` section. Shapes that overlap the view are listed and counted.
  Focusing one whose center is off-screen doesn't move the map. Its tooltip, focused or hovered,
  pins inside the view. New API: `FeatureListItem.geometry`
  and `.bbox`, `MapContext.focusedAnchor`, `geometryBbox`, and `intersectsBounds`.
- `CLAUDE.md` architecture notes: mention the shape-aware `inView` and `focusedAnchor`.

## Deferred

- **Antimeridian.** Bounds and shapes that cross 180° aren't handled, as with points today.
  Revisit when a host map can pan across the date line. Record this in data-dashboard
  `DEFERRED.md`.

## Release

A PR into `main` (merging needs the user's yes). Then a version-bump PR for `0.1.0-beta.5` and a
GitHub Release through `release.yml` (a separate yes). After publish, tell the coordinator
(`data-dashboard-4a`): monitor-map-72 is holding monitor-map 5.0.0-beta.0 until beta.5 is on npm.
