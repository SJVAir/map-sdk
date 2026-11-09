# Shapes That Cover the View Count as In View: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shape is listed and counted when its geometry overlaps the view. Focusing or hovering
a shape whose label point is off-screen pins its tooltip inside the view, and focusing it doesn't
pan the map to the off-screen label point.

**Architecture:** One pure geometry module (`src/lib/core/shape-view.ts`) holds the bbox, the
intersection test, and the in-view anchor. `inView` and `shapesPlugin` use it for listing.
`MapContext` uses it to decide focus (pan or stay) and exposes `focusedAnchor` and `anchorFor`.
`MapTooltip` anchors at those.

**Tech Stack:** TypeScript, Svelte 5 runes, Vitest (unit / client / browser projects), GeoJSON
types from `geojson`.

**Spec:** `docs/superpowers/specs/2026-11-08-in-view-shapes-design.md`

## Global Constraints

- Branch `fix/in-view-shapes`. Never commit on `main`. No Claude or AI attribution anywhere.
- Every API addition is optional. No existing signature changes (the coordinator asked to be told
  before any such change).
- Nothing module-global: caches are owned by a plugin instance or a `MapContext`.
- Points (items with no `geometry`) behave exactly as today.
- No antimeridian handling.
- `./data` and `./stores` must stay off the map engine: run `npm run test:bundle` before each
  commit under `src/lib`.
- Code style: tabs, double quotes, no trailing commas, width 100; `npm run format` before
  committing.
- Specs live in `tests/`, never `src/lib`.

## Review Focus

1. **A plume vertex exactly on a view edge, or a shape that only touches the view along an edge.**
   Counts as in view (edges included, like points). Pinned in Task 1.
2. **A focus before the map has settled bounds** (`map.bounds` is `null`, or the canvas width is
   0, as in `fake-gl`). It must not throw. With no usable view it falls back to today's
   pan-to-`lngLat`. Pinned in Task 3.
3. **A data reload that replaces the feature objects** while a row is focused. The cache must
   measure the new objects, not return stale bboxes, and `focusedAnchor` stays as computed.
   Pinned in Task 2.
4. **The focused row's shape disappears from the data** (the next day's smoke). The tooltip goes
   away as today. A stale `focusedAnchor` must not draw a tooltip for nothing. Pinned in Task 4.
5. **A ring that isn't closed, or a polygon with fewer than 3 points.** No throw. Not in view
   unless a vertex is inside the view, and the anchor returns `null`. Pinned in Task 1.

---

### Task 1: The geometry module, fixture, and shape-aware `inView`

**Files:**
- Create: `src/lib/core/shape-view.ts`
- Create: `tests/fixtures/hms-smoke-plume-2026-11-08.json`. Copy it verbatim from
  `/home/alex/workspace/sjvair/monitor-map/smoke-plume-2026-11-08.json`, the raw
  `GET /api/2.0/hms/smoke/` response `{ "data": [one plume] }`. Don't move or commit anything in
  monitor-map.
- Create: `tests/fixtures/plume.ts`. It exports `plumeFeature()`: a GeoJSON `Feature` with the
  fixture's geometry and properties `{ refKey: "feature:<id>", name: "Smoke", value: "light" }`.
- Modify: `src/lib/core/plugin.ts`. Add optional `geometry?: Geometry` and
  `bbox?: [number, number, number, number]` to `FeatureListItem`, with doc comments from spec §2.
- Modify: `src/lib/ui/feature-list.ts`. `inView` filters with `intersectsBounds`; update its doc
  comment.
- Modify: `src/lib/index.ts`. Export `geometryBbox` and `intersectsBounds`.
- Test: `tests/unit/core/shape-view.test.ts` (new), `tests/unit/ui/feature-list.test.ts`.

**Interfaces:**
- Produces, in `src/lib/core/shape-view.ts` (imports only `geojson` types and `Bounds`):
  - `type Bbox = [west: number, south: number, east: number, north: number]`
  - `geometryBbox(geometry: Geometry): Bbox | null`. Null when there are no coordinates. Covers
    Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon, and GeometryCollection.
  - `intersectsBounds(item: { lngLat: [number, number]; geometry?: Geometry; bbox?: Bbox }, bounds: Bounds): boolean`.
    Spec §1: bbox pre-check (`item.bbox ?? geometryBbox`), then the exact test. With no geometry,
    or a GeometryCollection or MultiPoint, it uses the `lngLat`-in-bounds test.
  - `containsPoint(geometry: Geometry, p: [number, number]): boolean`. Inside an outer ring and
    outside its holes, for any polygon. False for non-polygons.
  - `shapeAnchor(geometry: Geometry, view: Bounds, center: [number, number]): [number, number] | null`.
    Spec §3 steps 1 and 2: `center` if `containsPoint`. Otherwise an interior point of the
    shape's visible part (below). Otherwise `null`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/core/shape-view.test.ts`. Use the view
  `V = { west: -121, south: 36, east: -119, north: 38 }` and `polygon(...)` helpers built inline:
  - `covers the view with its centroid outside`: a polygon spanning lng -124 to -118, lat 26 to
    39, so its centroid is about lat 32.5. Then `intersectsBounds({ lngLat: [-121.2, 32.5], geometry }, V)`
    is true.
  - `fully outside`: a square at lng -110 to -109 is false.
  - `partial overlap`: a square over V's south-west corner is true.
  - `multipolygon`: one part inside and one outside is true. Both outside is false.
  - `diagonal bbox overlaps, area doesn't`: the triangle `[-123,40],[-120,40],[-123,37]`
    (bbox lng -123 to -120, lat 37 to 40, overlapping V; its hypotenuse `x − y = −160` passes
    north-west of V's corner `[-121,38]`) is false.
  - `view inside a hole`: an outer ring lng -125 to -115, lat 30 to 42, with a hole lng -122 to
    -118, lat 35 to 39, is false. Without the hole it is true.
  - `line crosses with no vertex inside`: `LineString [[-122,37],[-118,37]]` is true.
  - `no geometry`: `lngLat` inside is true, outside is false.
  - `touching edge`: a square whose east edge is `-121` (V's west) is true (Review Focus 1).
  - `degenerate`: a 2-point polygon and an unclosed ring don't throw. Both are false when no
    vertex is in V, and `shapeAnchor` returns `null` for both (Review Focus 5).
  - `geometryBbox` for each geometry type, plus `null` for `Polygon []`.
  - `shapeAnchor`: it returns `center` when the shape contains it. For a shape that only covers
    V's east half, the result is inside both V and the shape (`containsPoint`). For the hole case,
    with the hole over `center` but the ring visible, the result is inside the shape and V and not
    in the hole. For a line crossing V, the result is on the visible piece, inside V.
  - The fixture plume: `intersectsBounds` is true for the default Valley view
    `{ west: -122.51, south: 35.29, east: -116.89, north: 38.1 }` with `lngLat` = its
    `labelPoint` (off-screen). `containsPoint(plume, [-119.7, 36.7])` is true.

  Add to `tests/unit/ui/feature-list.test.ts`: `inView` keeps a shape item whose `lngLat` is out
  but whose geometry covers the bounds, and keeps today's results for point items.

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run --project unit tests/unit/core/shape-view.test.ts tests/unit/ui/feature-list.test.ts`
  Expected: FAIL (module not found, and the new `inView` case fails).

- [ ] **Step 3: Implement `shape-view.ts`.** Planar lng/lat. For the exact polygon test: any
  vertex in the rect, or any rect corner `containsPoint`, or any ring edge crossing any rect edge
  (segment-segment with collinear and touching cases counted). For `shapeAnchor`'s step 2:
  - Polygons: clip each ring to `view` (Sutherland–Hodgman against the four edges). Pick the
    polygon whose clipped outer ring has the largest area. Cast a horizontal line at the middle
    latitude of that clipped ring's bbox. Intersect it with every clipped ring of that polygon,
    holes included. Sort the x values and pair them into interior spans. Return the midpoint of
    the widest span. If the line hits a vertex exactly, nudge the latitude by 1e-9 of the bbox
    height.
  - Lines: clip each segment to `view` (Liang–Barsky). Return the midpoint of the longest clipped
    segment.
  - Return `null` if nothing remains.
  Then change `inView` to `items.filter((item) => intersectsBounds(item, bounds))`, add the two
  `FeatureListItem` fields, and export the helpers from `src/lib/index.ts`.

- [ ] **Step 4: Run to verify they pass.** Same command. Expected: PASS. Then
  `npm run test:unit`: everything passes.

- [ ] **Step 5: Commit.**
  ```bash
  npm run format && npm run check && npm run test:bundle
  git add src/lib/core/shape-view.ts src/lib/core/plugin.ts src/lib/ui/feature-list.ts src/lib/index.ts tests/unit/core/shape-view.test.ts tests/unit/ui/feature-list.test.ts tests/fixtures/hms-smoke-plume-2026-11-08.json tests/fixtures/plume.ts
  git commit -m "A shape is in view when its geometry overlaps the view"
  ```
  If `tests/unit/package.test.ts` pins the export list, add the two names there in this commit.

### Task 2: `shapesPlugin` items carry `geometry` and a cached `bbox`

**Files:**
- Modify: `src/lib/plugins/shapes.svelte.ts` (`features()`, around lines 131–162)
- Test: `tests/client/plugins/shapes.test.ts`

**Interfaces:**
- Consumes: `geometryBbox` and `Bbox` from Task 1.
- Produces: every item from `shapesPlugin().features()` has `geometry` (the feature's geometry
  object, by identity) and `bbox`.

- [ ] **Step 1: Write the failing tests** in `tests/client/plugins/shapes.test.ts`, using the
  file's `setup` and `TestSource`:
  - `items carry geometry and bbox`: `item.geometry` is the feature's geometry object (`toBe`).
    `item.bbox` equals `geometryBbox(geometry)`.
  - `measures each feature once`: two `features()` calls on the same collection return items
    whose `bbox` arrays are identical (`toBe`), and the same goes for `lngLat`.
  - `a reload measures the new features`: replace the source's collection with new feature
    objects whose geometry differs, then check that `features()` returns the new bbox (Review
    Focus 3).

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run --project client tests/client/plugins/shapes.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Inside `shapesPlugin` (per instance, not module scope), add
  `const measured = new WeakMap<Feature, { lngLat: [number, number] | null; bbox: Bbox | null }>()`.
  `features()` reads or fills it per feature object and sets `geometry` and `bbox` on each item.
  Skip `bbox` when it is `null`.

- [ ] **Step 4: Run to verify they pass.** Same command, then `npm run test:client`: everything
  passes.

- [ ] **Step 5: Commit.**
  ```bash
  npm run format && npm run test:bundle
  git add src/lib/plugins/shapes.svelte.ts tests/client/plugins/shapes.test.ts
  git commit -m "shapesPlugin lists geometry and a bbox measured once per feature"
  ```

### Task 3: Focus stays put for an overlapping shape; `focusedAnchor` and `anchorFor`

**Files:**
- Modify: `src/lib/core/create-map.svelte.ts` (`MapContext` interface near line 187,
  `focusFeature` at lines 438–454, `destroy` at around line 550)
- Test: `tests/client/core/create-map.test.ts`

**Interfaces:**
- Consumes: `intersectsBounds`, `shapeAnchor`, `containsPoint` (Task 1). Items with `geometry`
  (Task 2).
- Produces on `MapContext`:
  - `readonly focusedAnchor: [number, number] | null`. Reactive. Set by `focusFeature`, `null`
    when focus clears, and cleared on `destroy`.
  - `anchorFor(item: FeatureListItem): [number, number]`. No camera move. It returns `item.lngLat`
    when the item has no geometry, there is no GL map, or `lngLat` is in the live view. Otherwise
    it tries `shapeAnchor` in the clear view, then in the live view, and falls back to `lngLat`.
    Used by the tooltip for hover.

Definitions (private helpers in the same file):
- **Live view:** `gl.getBounds()` as `Bounds`. **Live center:** `gl.getCenter()`.
- **Clear view:** the live view with the panel's share cut off its side. Let
  `f = #listInset / gl.getCanvas().clientWidth`. Use `f = 0` when the width is 0 or missing, and
  clamp to [0, 1). A left panel moves `west` to `west + f × (east − west)`; a right panel moves
  `east` to `east − f × (east − west)`. **Clear center:** `[(clear.west + clear.east) / 2, liveCenter.lat]`.

`focusFeature` decision (spec §3). `found.item` is `it`, and the ease is today's
`easeTo({ center, offset?, duration? })`:

| Case | Camera | `focusedAnchor` |
| --- | --- | --- |
| no `geometry`, or `lngLat` in live view | ease to `lngLat` (today) | `lngLat` |
| intersects live view, `shapeAnchor(clear, clearCenter)` = `a` | stop the running ease: `easeTo({ center: [liveCenter.lng, liveCenter.lat], duration: 0 })`, no offset | `a` |
| intersects live view, no `a`, `shapeAnchor(live, liveCenter)` = `b` | ease to `b` | `b` |
| not in live view, `map.bounds` set and intersected, `shapeAnchor(map.bounds, its middle)` = `c` | ease to `c` | `c` |
| otherwise | ease to `lngLat` | `lngLat` |

- [ ] **Step 1: Write the failing tests** in `tests/client/core/create-map.test.ts`, following
  the `focusFeature` test at lines 225–255 (`createFakeGl` starts at center (-119.7, 36.7), zoom 7,
  and its `getBounds` spans ±2.8125 lng and ±1.40625 lat). Add a plugin whose `features()`
  returns one item built from `plumeFeature()`, with `lngLat` = its `labelPoint` and
  `geometry` set:
  - `focusing a covering plume doesn't move the camera`: after `focusFeature`, `gl.getCenter()`
    is unchanged, and the only new move is the `duration: 0` stop at the current center.
    `map.focusedAnchor` equals `[-119.7, 36.7]`.
  - `with the list panel open, the anchor is the clear part's center`: stub
    `gl.getCanvas().clientWidth` to 800, call `setListInset(240)`, and expect
    `focusedAnchor[0]` to be close to `-119.7 + 0.15 × 5.625`.
  - `a shape whose label point is on screen pans as today`: a small square around (-119, 37) gets
    an ease to its `lngLat`, and `focusedAnchor` equals `lngLat`.
  - `a shape visible only under the panel eases a little`: a square inside the live view's
    western 20%, with the panel at 30%. The camera eases to a point inside the square, not to the
    label point.
  - `points unchanged`: the existing test passes as is, and `focusedAnchor` equals the point's
    `lngLat`.
  - `focus(null) and destroy clear focusedAnchor`.
  - `no settled bounds and no canvas width don't throw` (Review Focus 2).
  - `anchorFor`: it returns the clear center for the plume, `lngLat` for a point, and never moves
    the camera (`gl.moves` unchanged).

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run --project client tests/client/core/create-map.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the table above, plus `focusedAnchor` (`$state.raw`) and `anchorFor`
  on the interface and the class. Doc comments come from spec §3.

- [ ] **Step 4: Run to verify they pass.** Same command, then `npm run test:client`: everything
  passes.

- [ ] **Step 5: Commit.**
  ```bash
  npm run format && npm run check && npm run test:bundle
  git add src/lib/core/create-map.svelte.ts tests/client/core/create-map.test.ts
  git commit -m "Focusing a shape that overlaps the view keeps the camera and pins inside it"
  ```

### Task 4: The tooltip anchors at the in-view point; browser tests with the real plume

**Files:**
- Modify: `src/lib/ui/MapTooltip.svelte` (the `anchor` derived, around lines 72–77)
- Test: `tests/browser/in-view-shapes.browser.test.ts` (new)

**Interfaces:**
- Consumes: `map.focusedAnchor` and `map.anchorFor(item)` (Task 3). Shape-aware `inView` (Task 1).
  Items with geometry from `hmsSmokePlugin` and `regionsPlugin`, through `shapesPlugin` (Task 2).

Anchor rule in `MapTooltip`:
- Pointer mode with no focus: `map.hovered.lngLat` (today).
- Focused: `map.focusedAnchor ?? item?.lngLat`. Only when `item` is found, so a focused feature
  that left the data shows no tooltip (Review Focus 4).
- Hovered in pinned mode: the hover anchor, else `item?.lngLat ?? map.hovered?.lngLat` (today).
  The hover anchor is `map.anchorFor(item)`, computed once per hovered refKey and plugin (read in
  `untrack`, keyed on those two primitives), so pointer moves within one shape don't recompute it.

- [ ] **Step 1: Write the failing tests** in `tests/browser/in-view-shapes.browser.test.ts`. Set
  up like `tests/browser/hms-smoke-tooltip.browser.test.ts`: `createMap`, `hmsSmokePlugin` on a
  `TestSource` holding `plumeFeature()`, `createFakeGl({ styleLoaded: true })`, `attach`. Then set
  the bounds with `map.updateView(camera, <fake gl's bounds>)`.
  - `a covering plume gets a list row`: render `FeatureList`. An option named `/Smoke/` exists.
  - `the summary counts it`: render `ViewSummary`, trigger an update (move the bounds slightly and
    wait `SUMMARY_DEBOUNCE_MS`), and expect the text to contain the smoke count of 1. Take the exact
    string from `summaryText` with the same inputs, not a hand-written literal.
  - `focusing the row keeps the camera and pins the tooltip near the middle`: render `MapTooltip`
    with `project` mapping lng/lat linearly onto a 800×600 box over the fake bounds, with
    `width: 800, height: 600`. Then focus the row with the keyboard (Tab to the listbox, ArrowDown),
    expect `gl.getCenter()` to be unchanged, and check that the tooltip's box contains x = 400
    within its width and sits within 100 px of y = 300.
  - `arrowing from a point row onto the plume leaves the camera where it is`: add one point plugin
    item at (-119, 37). Arrow onto it (an ease), then onto the plume. The last move is the
    `duration: 0` stop.
  - `hover, pinned mode`: add a `regionsPlugin` (or `shapesPlugin`, plain mode, `hoverable` on)
    with a large polygon whose label point is off-screen. Emit a `mousemove` over it (as the smoke
    test does with `setRenderedFeatures`). The tooltip is inside the box and not at its edge
    (top > 0 and bottom < 600).
  - `hover, label point on screen`: a small shape gets its tooltip anchored at `project(lngLat)`
    (today).
  - `focused shape gone from the data`: focus the plume, replace the source's collection with an
    empty one, and expect no tooltip.

- [ ] **Step 2: Run to verify they fail.**
  Run: `npx vitest run --project browser tests/browser/in-view-shapes.browser.test.ts`.
  Expected: the hover and pin-position cases FAIL. The list and summary cases may already pass
  after Tasks 1–3, which is fine.

- [ ] **Step 3: Implement** the anchor rule in `MapTooltip.svelte`.

- [ ] **Step 4: Run to verify they pass.** Same command, then `npm run test:browser`: everything
  passes, including `tooltip.browser.test.ts` and `hms-smoke-tooltip.browser.test.ts` unchanged.

- [ ] **Step 5: Commit.**
  ```bash
  npm run format && npm run lint && npm run test:bundle
  git add src/lib/ui/MapTooltip.svelte tests/browser/in-view-shapes.browser.test.ts
  git commit -m "Tooltips for shapes with an off-screen center pin inside the view"
  ```

### Task 5: Docs, the deferral, and the full check

**Files:**
- Modify: `README.md`. In "Writing a plugin", document `geometry` and `bbox` on `FeatureListItem`
  and the focus and hover rule. Add `geometryBbox`, `intersectsBounds`, `focusedAnchor`, and
  `anchorFor` where the API is listed. Add a `### 0.1.0-beta.5` section at the top of "Changes",
  in the style of beta.4: what changes for every map, then **New API:** with the names above.
- Modify: `tests/unit/readme-examples.test.ts`, only if a README example changes.
- Modify: `CLAUDE.md`. Under Core, mention `shape-view.ts` (shape-aware in-view and the anchor)
  and `focusedAnchor` / `anchorFor`.
- data-dashboard, in a worktree `.worktrees/docs-map-sdk` from `origin/main` (fetch first):
  - Add an antimeridian entry to `DEFERRED.md` under "Map & selection". Why: the SDK targets the
    Valley, and neither points nor shapes handle bounds across 180°. Revisit trigger: a host map
    that can pan across the date line.
  - Update map-sdk's row and status in `TODO.md` ("in-view shapes fix: PR open").
  - Docs-only, so commit straight to data-dashboard `main` after a rebase. Pushing needs the
    user's yes.

- [ ] **Step 1: Write the docs above.**
- [ ] **Step 2: Run the full check.**
  Run: `npm run format && npm run lint && npm run check && npm test && npm run test:bundle && npm run test:licenses && npx playwright test --project chromium --project firefox`
  Expected: all pass.
- [ ] **Step 3: Commit the map-sdk docs.**
  ```bash
  git add README.md CLAUDE.md tests/unit/readme-examples.test.ts
  git commit -m "README and CLAUDE.md: in-view shapes, focusedAnchor, anchorFor; beta.5 notes"
  ```
- [ ] **Step 4: Commit the data-dashboard docs** in its worktree (`DEFERRED.md`, `TODO.md`).
  Ask the user before pushing.
- [ ] **Step 5: Hand off.** Ask the user before pushing the branch or opening the PR. Merging,
  the version-bump PR, the release, and tags each need their own yes. Tell the coordinator
  (`data-dashboard-4a`) when the PR opens, when it merges, and when beta.5 is on npm.
