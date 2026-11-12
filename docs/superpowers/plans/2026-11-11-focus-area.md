# The focus area and its labelled pin (part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A preset plugin, `focusAreaPlugin`, that marks the place a map is about:
- **a polygon** with a two-tone outline and a faded wash outside it;
- **a point** with a two-tone ring and a label beside it, listed as one feature-list row and clickable for a label-only card.

It replaces the dashboard's own pin (its `"pin"` `pointsPlugin`, `pinIcon`, `pin-label.svelte.ts` and its direct `@maptiler/sdk` dependency). It ships as `@sjvair/map-sdk` `0.1.0-beta.11`.

**Architecture:**
- **One standalone plugin** (`src/lib/presets/focus-area.svelte.ts`). It doesn't wrap `pointsPlugin` or `shapesPlugin`, since its layers are its own. It keeps the geometry and label in `$state` on the plugin object, so a restyle, detach or remount draws the current ones again.
- **The host changes the focus with `plugin.set({ geometry, label })`,** which validates synchronously and throws at the call site.
- **Three new theme colors** (`focusArea`, `focusAreaCasing`, `focusAreaWash`) and `background` join `ThemeColors`. `themeSignature` then covers them, so a theme change restyles the map as it does today.
- **A point's item carries a new `FeatureListItem.noReading`,** so the row, its accessible name and the card show the name alone, with no "No level".
- **The label is a GL symbol layer.** Canvas text is never read aloud, so the list row is what names the place to screen readers. It stays under the data plugins with the rest of the plugin.

**Tech Stack:** Svelte 5 runes, TypeScript, MapTiler SDK 4.2 (MapLibre), Vitest (unit, client, browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-options-toolbar-and-widget-needs-design.md`, section "3. Focus area", including the point-pin decisions of 2026-11-11 (ring, listed and clickable, `--focus-area`). Parts 1 and 2 are merged (`0.1.0-beta.10`).

## Global Constraints

- **Opt-in:** a map without `focusAreaPlugin` behaves exactly as in `0.1.0-beta.10`. `noReading` is optional and unset everywhere else.
- **Values from the spec:**
  - Line 2.5px at 0.9 opacity, round joins.
  - Casing 5.5px (line + 3px) at 0.9 opacity, under the line.
  - Wash at 0.55 opacity over a world polygon `[-180, -85]`–`[180, 85]`, with each part's outer ring punched out. A part's own holes stay covered.
  - No tint inside.
  - Ring: 13px radius, 3px stroke, no fill, at 0.9 opacity, on a casing 1.5px wider each side.
- **Tokens:** `--focus-area` → `--foreground` (the line and the ring); `--focus-area-casing` → `--background`; `--focus-area-wash` → `--background`. The label is `--foreground` text with a `--background` halo. Never `--highlight` or `--primary`.
- **The polygon** isn't listed, clicked or hovered (none of its layers is interactive).
- **The point** is listed once, clickable and hoverable, and never selectable.
- **Geometries:** Polygon, MultiPolygon and Point, or `null` (nothing drawn). Anything else throws `map-sdk: focusAreaPlugin takes a Polygon, MultiPolygon or Point, not <type>`.
- **Every UI string is a `mapsdk_*` key** (this part adds none: the label and layer name are the host's). Nothing module-global. Code style: tabs, double quotes, no trailing commas, width 100, runes only.
- **Before each commit under `src/lib`:** `npm run lint && npm run check && npm test && npm run test:bundle`.
- **No Claude or AI attribution.** Push and PR, merge, and the release each need the user's yes.

## Review Focus

1. **Holes in either winding:** a hole is punched out of the wash whatever winding the host's rings use (GeoJSON says CCW outer, but servers send both). MapLibre classifies rings by winding, so a wrong-winding hole would merge with the world ring. Pinned in Task 2.
2. **`set()` before the map is attached, or while it's detached:** the focus draws on attach, and a remount keeps it. Pinned in Task 3.
3. **Point → `null` while its card is pinned:** the row goes and the card closes. Pinned in Task 4 (it relies on `MapContext` dropping a pin whose item is gone; if it doesn't, fix it there).
4. **Point → Polygon:** the ring, label and row go, and the wash appears, with nothing left of the point. Pinned in Task 3.
5. **A monitor on the point:** the monitor takes the click and the hover; the ring takes them only where nothing above it is hit. Pinned in Task 4 (router order, plugin added below).

---

### Task 0: Branch

- [ ] Branch `feat/focus-area` exists (it holds the spec update, bd23202). Commit this plan: `git add docs/superpowers/plans/2026-11-11-focus-area.md && git commit -m "Plan: focus area and its labelled pin"`

### Task 1: Focus-area theme colors

**Files:**
- Modify: `src/lib/plugins/style.ts` (`ThemeColors`, `FALLBACK_THEME_COLORS`, `THEME_TOKENS`)
- Test: `tests/unit/plugins/style.test.ts`, `tests/browser/` (wherever `themeColors` is read from a DOM today; add to that file)

**Interfaces:**
- Produces: `ThemeColors` gains:
  - `focusArea` (`["--focus-area", "--foreground"]`, fallback `#111827`);
  - `focusAreaCasing` (`["--focus-area-casing", "--background"]`, fallback `#ffffff`);
  - `focusAreaWash` (`["--focus-area-wash", "--background"]`, fallback `#ffffff`);
  - `background` (`["--background"]`, fallback `#ffffff`).

- [ ] **Step 1: Write the failing tests:**
  - unit: `FALLBACK_THEME_COLORS` has the four new keys with the values above, and `themeColors(null)` returns them;
  - browser: with only `--foreground: rgb(1, 2, 3)` and `--background: rgb(4, 5, 6)` set, `focusArea` is `rgba(1, 2, 3, 1)` and `focusAreaCasing`, `focusAreaWash` and `background` are `rgba(4, 5, 6, 1)`. With `--focus-area: rgb(7, 8, 9)` set, `focusArea` is `rgba(7, 8, 9, 1)`;
  - browser: `themeSignature` changes when `--focus-area-wash` changes.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/plugins/style.test.ts` and the browser file. Expected: FAIL.
- [ ] **Step 3:** Add the keys. Update the `ThemeColors` doc comments.
- [ ] **Step 4:** Run the same commands. Expected: PASS. Also `npm run check`: every `ThemeColors` literal in `tests/` must gain the keys.
- [ ] **Step 5: Commit:** `git commit -am "style: focus-area theme colors"`

### Task 2: The geometry helpers

**Files:**
- Create: `src/lib/presets/focus-geometry.ts`
- Test: `tests/unit/presets/focus-geometry.test.ts`

**Interfaces:**
- Produces:
  - `export type FocusGeometry = Polygon | MultiPolygon | Point` (from `geojson`).
  - `assertFocusGeometry(geometry: unknown): asserts geometry is FocusGeometry | null`. It throws the Global Constraints message for any other type, an object with no `type`, or a Point whose first two coordinates aren't finite numbers.
  - `worldMask(geometry: Polygon | MultiPolygon): Polygon`. Its ring 0 is the world ring `[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]]`, counter-clockwise, followed by each part's outer ring as a hole, made clockwise (reversed when the input's is CCW). Empty or degenerate rings (fewer than 4 positions) are skipped.

- [ ] **Step 1: Write the failing tests** (`describe("assertFocusGeometry")`, `describe("worldMask")`):
  - It accepts Polygon, MultiPolygon, Point and `null`.
  - It throws for `LineString` with a message containing `"not LineString"`; for `{}`, `"x"` and `undefined` with `"not unknown"`; and for a Point `[NaN, 1]`.
  - `worldMask` of one square gives 2 rings: the world ring (positive signed area) and the square (negative signed area), whatever the input winding (test both).
  - A MultiPolygon of 2 parts gives 3 rings.
  - A polygon with a hole gives 2 rings: its hole isn't punched, so it stays washed.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/presets/focus-geometry.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Signed area by the shoelace sum, as `ringArea` in `shapes.svelte.ts` without the `abs`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "focus area: geometry check and world mask"`

### Task 3: `focusAreaPlugin`, the drawing

**Files:**
- Create: `src/lib/presets/focus-area.svelte.ts`
- Modify: `src/lib/index.ts` (export the plugin and its types beside the other presets)
- Test: `tests/client/presets/focus-area.test.ts` (the `PluginHost` + `createFakeGl` setup of `tests/client/plugins/shapes.test.ts`)

**Interfaces:**
- Consumes: Task 1's colors, Task 2's `FocusGeometry`, `assertFocusGeometry` and `worldMask`.
- Produces:
  ```ts
  export interface FocusAreaPluginOptions {
  	/** Default "focus-area". */
  	id?: string;
  	/** Already-translated layer name: the point's group in the list and summary. */
  	layerLabel: string;
  	/** Default null (nothing drawn). */
  	geometry?: FocusGeometry | null;
  	/** A point's label ("Your location", a school's name). Ignored for a polygon. */
  	label?: string;
  }
  export interface FocusAreaPlugin extends MapPlugin {
  	/** Replaces the geometry and label. Throws like the options. */
  	set(focus: { geometry: FocusGeometry | null; label?: string }): void;
  	readonly geometry: FocusGeometry | null;
  	readonly label: string | undefined;
  }
  export function focusAreaPlugin(options: FocusAreaPluginOptions): FocusAreaPlugin;
  ```
- Layers, local ids in draw order:
  - `wash`: fill over `worldMask`, `fill-color` `focusAreaWash`, `fill-opacity` 0.55;
  - `casing`: line, `focusAreaCasing`, width 5.5, opacity 0.9, round join and cap;
  - `line`: line, `focusArea`, width 2.5, opacity 0.9, round join and cap;
  - `ring-casing`: circle, radius 11.5, stroke width 6, `focusAreaCasing`, opacity 0, stroke opacity 0.9. MapLibre strokes outside the radius, so it spans 11.5 to 17.5px;
  - `ring`: circle, radius 13, stroke width 3, `focusArea`, opacity 0, stroke opacity 0.9;
  - `label`: symbol with `text-field` `["get", "name"]`, `text-anchor` `"left"`, `text-offset` `[1.5, 0]`, `text-size` 12, allow-overlap and ignore-placement on, `text-color` `foreground`, `text-halo-color` `background`, `text-halo-width` 2.

  The two sources are `area` (the polygon, for both lines) and `mask`, plus `point` (one feature, `{ refKey: "feature:<id>", name: <label ?? layerLabel> }`). All are added once, and `set` only calls `setData`. A geometry of the other kind gets an empty collection.

- [ ] **Step 1: Write the failing tests** (`describe("focusAreaPlugin")`):
  - **"draws a polygon as wash, casing and line":** the layer ids are in the order above, each with the paint values above, and the colors are `FALLBACK_THEME_COLORS`' focus values. The `mask` source data is `worldMask(geometry)`, and the `point` source is empty.
  - **"draws a point as ring casing, ring and label":** the `point` source has the one feature, with the label as `name`, and `area` and `mask` are empty.
  - **"set() replaces the data without re-adding layers":** going Polygon → Point → null, the layer ids are unchanged, the `setData` calls match each geometry, and `null` empties all three sources.
  - **"set() throws for a LineString and keeps the last geometry".**
  - **"the options throw for a LineString".**
  - **"set() before attach draws on attach".**
  - **"keeps the focus across detach and attach":** `host.detach()`, then `host.attach(createFakeGl(...))`, and the new gl's sources hold the current geometry.
  - **"draws with the new theme after a restyle":** `host.restyle(true)` re-adds the layers (the colors are re-read at setup).
  - **"registers only the ring layers as interactive":** the router knows `ring-casing` and `ring`, and never `wash`, `casing` or `line`. So a polygon is never clicked or hovered, which is what `hoverable: false` would give, without a getter that changes with the geometry.
- [ ] **Step 2:** Run `npx vitest run --project client tests/client/presets/focus-area.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `$state.raw` holds `{ geometry, label }`.
  - `setup` reads `themeColors` like `shapesPlugin` and adds the three sources and six layers.
  - A `ctx.effect` over the state calls `setData`, passing plain objects, since MapLibre structured-clones the data.
  - `interactive([ringCasing, ring], hitFromProps)` registers the point. The polygon layers are never registered.
  - `selectable: false`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "focusAreaPlugin: polygon wash and outline, point ring and label"`

### Task 4: The point in the list and its card

**Files:**
- Modify: `src/lib/core/plugin.ts` (`FeatureListItem.noReading`), `src/lib/ui/feature-list.ts` (`levelText`, `rowLabel`), `src/lib/ui/TooltipItem.svelte`, `src/lib/ui/FeatureList.svelte` (the row's level place), `src/lib/presets/focus-area.svelte.ts` (`features()`)
- Test: `tests/unit/ui/feature-list.test.ts`, `tests/client/presets/focus-area.test.ts`, `tests/browser/feature-list.browser.test.ts`, `tests/browser/tooltip.browser.test.ts`

**Interfaces:**
- Produces:
  - `FeatureListItem.noReading?: boolean`. Its doc: "A place with no reading (a focus point): its row, accessible name and tooltip show its name alone, with no value, level or 'No level'. Default false."
  - `levelText` gains the kind `"omit"`, with text `""`, for a `noReading` item.
  - `rowLabel` gives `item.name` alone for one.
  - The focus plugin's `features()` gives `[]` for a polygon or `null`. For a point it gives one item: `refKey` `feature:<id>`, `ref` `{ kind: "feature", id }`, `name` the label (else `layerLabel`), `value: null`, `level: NO_LEVEL`, `units: ""`, `lngLat` the point, `selectable: false`, `noReading: true`.

- [ ] **Step 1: Write the failing tests:**
  - **unit:** `levelText` of a `noReading` item is `{ kind: "omit", text: "" }`, and its `rowLabel` is the name.
  - **client:** `features()` per geometry, as above. A click hit on the ring layer gives `pluginId` the plugin's id and its `refKey`.
  - **browser, list:** a `noReading` row's level place renders no chip and no "No level", and its accessible name is exactly the name (`toHaveAccessibleName`).
  - **browser, tooltip:** a pinned `noReading` item's card shows the name header and no chip.
  - **browser, Review Focus 3:** pin the point's card, then `plugin.set({ geometry: null })`, and `map.pinned` becomes `null`.
  - **browser, Review Focus 5:** the focus plugin is added first and a monitors fixture plugin above it, at the same lngLat. `featuresAt` there lists the monitor first, and a click pins the monitor.
- [ ] **Step 2:** Run the four files. Expected: FAIL.
- [ ] **Step 3: Implement.** `TooltipItem` renders nothing for `"omit"`, and `FeatureList` leaves the row's level place empty. If Review Focus 3 fails, `MapContext` must drop a pinned hit whose plugin no longer lists its `refKey`. Check `#pinned`'s lookup and fix it there, with the failing test first.
- [ ] **Step 4:** Run the same files. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "focus point: listed with its label alone, a label-only card"`

### Task 5: Demo, e2e, screenshots

**Files:**
- Modify: `demo/App.svelte`, `e2e/demo.spec.ts`

- [ ] **Step 1:** On the `today` map (globe), add a "Focus" select: None, Fresno County (a hand-drawn approximate polygon in the demo, labelled as approximate in a comment), Two areas (a MultiPolygon), and Your location (a point near Fixture Alpha, label "Your location"). Add the plugin first, so it draws below smoke. Expose it on `__mapsdkDemo`.
- [ ] **Step 2: Write the failing e2e tests:**
  - **"focus point is a list row named by its label":** pick "Your location", open the list, and a row named exactly "Your location" is there.
  - **"clicking the focus ring pins its label-only card":** zoom to 14, project the point, click 14px right of it (on the ring, off any monitor), and the card's heading is "Your location", with no "No level".
  - **"a focus area isn't listed":** pick Fresno County, and no row has that name.
- [ ] **Step 3:** Run `npx playwright test --project chromium --project firefox`. Expected: FAIL, then PASS once Step 1 is in.
- [ ] **Step 4: Screenshots (the user asked, 2026-11-11).** Run `npm run dev` and capture the polygon and the point on each basemap, in light and dark, plus the globe zoomed out so the wash's edge shows. Send them to the user as images before the PR. Tune the values only with their say, and note any change in the PR.
- [ ] **Step 5: Commit:** `git commit -am "Demo and e2e: the focus area and its labelled pin"`

### Task 6: Docs, version, review

**Files:**
- Modify: `README.md`, `tests/unit/readme-examples.test.ts`, `package.json`, `package-lock.json`, `CLAUDE.md`, `src/lib/theme.css` (a comment only: the focus tokens are read by the map and never declared there)

- [ ] **Step 1:** README:
  - add the three tokens to the family-token table;
  - add a "Focus area" section after "Plugins and draw order": add it first, call `set()` to change it, the point is listed and clickable, the label is canvas text, so a host with `featureList={false}` names the place in `MapView`'s `label`;
  - add a "Changes" entry, `0.1.0-beta.11`;
  - add an example to `readme-examples.test.ts` that type-checks.
- [ ] **Step 2:** Bump to `0.1.0-beta.11` (`npm version 0.1.0-beta.11 --no-git-tag-version`). Add CLAUDE.md's Presets and theme lines (`focusAreaPlugin`, `noReading`, the tokens).
- [ ] **Step 3:** Run `npm run lint && npm run check && npm test && npm run test:bundle && npm run test:licenses`. Expected: all pass.
- [ ] **Step 4: Commit:** `git commit -am "0.1.0-beta.11: focus area and its labelled pin"`
- [ ] **Step 5:** Get a fresh whole-branch review on the most capable model. Fix Critical and Important findings with failing tests first.
- [ ] **Step 6: Record deferrals** in data-dashboard's `DEFERRED.md` → "Map & selection" (the `map-sdk:` entries), and map-sdk's row in `TODO.md`, in `.worktrees/docs-map-sdk` on `step-5`. Hold the push while the coordinator says spec 2's PR is open. Deferrals known now:
  - **The school under a focus point is drawn and listed twice** once part 4's schools layer exists. Revisit with part 4.
  - **Overlapping parts of a MultiPolygon** punch overlapping holes, which MapLibre may render unwashed or washed. Revisit if a real focus area has overlapping parts.
- [ ] **Step 7:** With the user's yes, push and open the PR. Then send `data-dashboard-d8` and the coordinator the exact signature (Task 3's Interfaces) and the PR link.
