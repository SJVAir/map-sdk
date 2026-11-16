# Region fills, shared Legend section, and parity fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@sjvair/map-sdk` `0.1.0-beta.15`: a no-figure region style, `regionsPlugin` pass-through, one Legend section per shared metadata scale with a "No data" row, and three parity fixes (folded phone attribution, checkbox-row chevron, narrow search slot width).

**Architecture:** The scale resolver tags each scale legend with its `ScaleRef` and metadata label; `shapesPlugin` gains `noFigure` paint and a legend flag; `legend-data.ts` groups sections by `ScaleRef` and `Legend.svelte` draws the group and its row. The attribution fold lives on `GlMap` in `create-gl-map.ts`; the chevron and search slot are markup/CSS in the options components.

**Tech Stack:** Svelte 5 runes, TypeScript, MapLibre via `@maptiler/sdk` `~4.2.0`, Vitest (unit/client/browser projects), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-region-fills-legend-parity-design.md`

## Global Constraints

- Every current caller (monitor-map 5.0, the dashboard) sees no change unless it sets a new option, except the three parity fixes, which every host gets.
- New options and defaults: `noFigure?: "neutral" | "outline"` default `"neutral"`; `regionsPlugin` `fillOpacity?` default 0.6, `outline?: "theme" | "level" | "none"` default `"theme"`.
- "No figure" = the feature has no level on the scale (`levelFor(value, scale) === NO_LEVEL`; on the map `levelKeyExpression(scale, "value")` is `""`).
- Legend sections share only on equal `ScaleRef` (`dataset` and `entryType`); a literal `Scale` never shares.
- New message `mapsdk_legend_no_figure`: `"No data"`. No concatenated strings.
- Theme tokens only (`--foreground` for the no-figure line and swatch); no new tokens; colour never carries meaning alone.
- WCAG 2.2 AA; axe on the Legend; the ⓘ credits button stays keyboard-operable.
- Tabs, double quotes, no trailing commas, width 100; `npm run format`; run `npm run test:bundle` before each commit touching `src/lib`.
- Specs live under `tests/`; hover-sensitive browser files call `tests/browser/park-pointer.ts` in `afterEach`.
- No AI attribution in commits, docs, PR or release notes. Push, merge and release each need the user's own yes.

## Review Focus

1. A no-figure feature that is selected: the selection ring and check still draw over the outline-only region (Task 2 test `selected no-figure region keeps its ring`).
2. A scale that changes while `noFigure: "outline"` is on (layers rebuilt): the new layers keep the no-figure paint (Task 2 test `rebuilt layers keep the no-figure paint`).
3. All features gain a figure after a reload: the "No data" row goes away (Task 2 test `noFigure flag clears when every feature has a level`).
4. The map widened past 640 px and narrowed again (MapLibre's `resize` path re-adds `compact-show`): it stays folded unless the person opened it (Task 5 test `narrowing after load stays folded`).
5. A shared group where the first member is loading (a status entry) and the second has a scale: the status line and the section both show, the section isn't dropped (Task 4 test `a loading member doesn't drop the shared section`).

---

### Task 1: Scale legends carry `scaleRef` and `scaleLabel`

**Files:**
- Modify: `src/lib/core/plugin.ts` (the scale form of `LegendData`, ~line 93)
- Modify: `src/lib/plugins/scale-resolution.svelte.ts` (`legend()`, ~line 81)
- Test: `tests/client/plugins/shapes.test.ts`, `tests/client/plugins/points.test.ts`; update existing `legend!()` `toEqual`s in the client tests that now gain `scaleRef`.

**Interfaces:**
- Produces: `LegendData` scale form gains `scaleRef?: ScaleRef; scaleLabel?: string; noFigure?: boolean` (`noFigure` declared here, set in Task 2). Doc each field.

- [ ] **Step 1: Write the failing tests** (in `shapes.test.ts`):
  - `legend carries the source's ScaleRef`: source `scale: SMOKE_REF` → `plugin.legend!()` `toMatchObject({ scaleRef: SMOKE_REF })`.
  - `legend has no scaleRef for a literal scale`: source `scale: smokeScale` → `expect("scaleRef" in plugin.legend!()!).toBe(false)`.
  - `legend carries the entry type's label once known`: metadata `entryType` resolves `{ label: "Smoke density", precision: 1 }` → after `settle()`, `toMatchObject({ scaleLabel: "Smoke density", title: "Smoke" })` (shapes keeps its title).
  - In `points.test.ts`: the monitors-style legend with `legendTitle: "entry-type"` has `scaleRef` and `scaleLabel` equal to its title.
- [ ] **Step 2: Run** `npx vitest run --project client tests/client/plugins` — expected FAIL on the new tests.
- [ ] **Step 3: Implement** in `legend()`: add `scaleRef: source.scale` only when it is a `ScaleRef` (not null, not `isScale`), and `scaleLabel: hint.label` only when the hint matches the input and has a label. Spread conditionally so absent fields stay absent.
- [ ] **Step 4: Run** `npm run test:unit && npm run test:client`; fix existing `toEqual` legend assertions that now include `scaleRef` (add the field; don't loosen to `toMatchObject`). Expected: PASS.
- [ ] **Step 5: Commit** `Legend data: a scale legend carries its ScaleRef and the entry type's label`.

### Task 2: `shapesPlugin` `noFigure`

**Files:**
- Modify: `src/lib/plugins/shapes.svelte.ts` (`ShapesOptions`, `buildLayers` ~line 206, `legend` ~line 132)
- Test: `tests/client/plugins/shapes.test.ts`

**Interfaces:**
- Consumes: `levelKeyExpression(scale, input)` and `colorExpression`/`opacityExpression` from `style.ts`; `levelFor`, `NO_LEVEL`.
- Produces: `ShapesOptions.noFigure?: "neutral" | "outline"`; under `"outline"`, `legend()` adds `noFigure: true` while some loaded feature with properties and geometry has `levelFor(value, scale) === NO_LEVEL`.

Let `noFig = ["==", levelKeyExpression(scale, "value"), ""]` (fixture `POLYGONS` has `value: 1` and `"heavy"`; add a third feature `{ refKey: "feature:c", name: "Charlie", value: null }`).

- [ ] **Step 1: Write the failing tests:**
  - `noFigure outline zeroes the fill where there is no level`: `fill-opacity` `toEqual(["case", noFig, 0, opacityExpression(smokeScale, "value", 0.6)])`; `fill-color` unchanged.
  - `noFigure neutral (default) keeps today's paint`: the first existing test's paint assertions hold with `noFigure` unset and with `"neutral"`.
  - `noFigure outline with outline level draws no-figure lines in the foreground`: `line-color` `toEqual(["case", noFig, FALLBACK_THEME_COLORS.foreground, colorExpression(...)])`, `line-opacity` `toEqual(["case", noFig, 1, opacityExpression(...)])`.
  - `noFigure outline with outline theme keeps today's outline` (theme line is already foreground for polygons).
  - `noFigure outline with outline none adds a no-figure line layer`: `layerIds` `["m1:shp:fill", "m1:shp:no-figure", "m1:shp:selected", "m1:shp:check"]`; that layer is `type: "line"`, `filter` `toEqual(["all", ["!", isLine], noFig])`, `line-color` foreground, `line-width` 1.
  - `plain mode ignores noFigure`: paint as in plain mode today.
  - `legend flags noFigure while a feature has no level`: with Charlie → `toMatchObject({ noFigure: true })`; with `noFigure` unset → no `noFigure` key.
  - `noFigure flag clears when every feature has a level`: `source.features = POLYGONS` (no null) → `"noFigure" in legend` false.
  - `rebuilt layers keep the no-figure paint`: change scale by value (as in `rebuilds the layers when the scale changes by value`) → new `fill-opacity` still the `case`.
  - `selected no-figure region keeps its ring`: select `feature:c` → `gl.featureState` selected as for other features, and `check` source has its label point.
- [ ] **Step 2: Run** `npx vitest run --project client tests/client/plugins/shapes.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** in `buildLayers`: when `choropleth && noFigure === "outline"`, wrap `fill-opacity` in the `case`; for `outline: "level"`, wrap `line-color`/`line-opacity` as above; for `outline: "none"`, add the `no-figure` line layer after the fill (not registered for interaction; the fill takes clicks). Include it in `layers` so `removeLayers` clears it. `legend` wraps `scales.legend()`, reading `source.features` reactively.
- [ ] **Step 4: Run** `npm run test:client && npm run test:bundle` — PASS.
- [ ] **Step 5: Commit** `shapesPlugin: noFigure "outline" draws regions with no level as an outline`.

### Task 3: `regionsPlugin` passes the shape options through

**Files:**
- Modify: `src/lib/presets/regions.ts`
- Test: `tests/client/presets/shapes-presets.test.ts`

**Interfaces:**
- Produces: `RegionsPluginOptions` gains `noFigure?: ShapesOptions["noFigure"]`, `fillOpacity?: number`, `outline?: ShapesOptions["outline"]`, each documented with its default.

- [ ] **Step 1: Write the failing tests:** `passes noFigure, fillOpacity and outline to the shapes`: `regionsPlugin({ ..., noFigure: "outline", fillOpacity: 0.4, outline: "none" })` → layer ids include `no-figure`, `fill-opacity` `case` uses 0.4 as the fallback. `keeps today's paint with nothing set`: `fill-opacity` equals `opacityExpression(scale, "value", 0.6)` and the outline layer exists.
- [ ] **Step 2: Run** `npx vitest run --project client tests/client/presets/shapes-presets.test.ts` — FAIL.
- [ ] **Step 3: Implement**: pass the three through; only set keys the caller set (or pass `undefined`, which `shapesPlugin` defaults).
- [ ] **Step 4: Run** the same — PASS.
- [ ] **Step 5: Commit** `regionsPlugin: noFigure, fillOpacity and outline pass through`.

### Task 4: Legend: one section per shared scale, and the "No data" row

**Files:**
- Modify: `src/lib/ui/legend-data.ts`, `src/lib/ui/Legend.svelte`, `src/lib/data/messages/en.json`
- Test: `tests/unit/ui/legend-data.test.ts`, `tests/browser/legend.browser.test.ts`

**Interfaces:**
- Consumes: Task 1/2's `scaleRef`, `scaleLabel`, `noFigure` on `LegendData`.
- Produces: `LegendSection` gains `scaleRef?: ScaleRef; scaleLabel?: string; noFigure: boolean` (`legendSection` copies them; `noFigure` defaults false). `export function shareSections(entries: LegendEntry[]): LegendEntry[]` in `legend-data.ts`.

`shareSections` keeps entry order; each `scale` entry whose `scaleRef` equals (same `dataset` and `entryType`) an earlier one's is folded into that earlier entry and removed from its own place. A group of two or more is titled with the first member's `scaleLabel` that is set, else the first member's title; `noFigure` is true if any member's is; units, bar and `pluginId` stay the first member's. A one-member section is returned unchanged. Status and symbols entries pass through untouched.

- [ ] **Step 1: Write the failing unit tests** (`legend-data.test.ts`, `describe("shareSections")`):
  - `merges sections with the same ScaleRef at the first one's place`: entries `[A(pm25 ref, "Counties"), S(smoke), B(pm25 ref, "PM2.5", scaleLabel "PM2.5")]` → `[merged(pluginId A, title "PM2.5"), S]`.
  - `keeps a lone section's title`: A alone with `scaleLabel: "PM2.5"` → title `"Counties"`.
  - `falls back to the first title when no member has a label`.
  - `doesn't merge different entry types, datasets, or a literal scale` (no `scaleRef`).
  - `noFigure is true when any member has it`.
  - `a loading member doesn't drop the shared section`: `[status(loading), A, B]` → `[status, merged]`.
- [ ] **Step 2: Write the failing browser tests** (`legend.browser.test.ts`, new `describe("shared sections")`, fake plugins as in the file's `fakeMap`):
  - `draws one section for two plugins with the same ScaleRef`: one `.mapsdk-legend-section`, heading `"PM2.5 (µg/m³)"`.
  - `ends the section with a No data row while a member has noFigure`: `page.getByText("No data")` visible inside that section; the swatch is `aria-hidden` and has a border and transparent background.
  - `shows no row without noFigure`.
  - `has no axe violations` with a shared section and the row (`axe.run` on the legend root).
- [ ] **Step 3: Run** `npx vitest run --project unit tests/unit/ui/legend-data.test.ts && npx vitest run --project browser tests/browser/legend.browser.test.ts` — FAIL.
- [ ] **Step 4: Implement**: `legendSection` copies the fields; `Legend.svelte`'s `entries` becomes `shareSections(...)` of today's list; under a scale section's bar, when `section.noFigure`, a `<p class="mapsdk-legend-nofigure text-sm">` with an `aria-hidden` swatch span (`1px solid var(--foreground)`, no fill, about the symbol row's size) and `map.messages("mapsdk_legend_no_figure")`. Add `"mapsdk_legend_no_figure": "No data"` to `en.json` in key order.
- [ ] **Step 5: Run** `npm run test:unit && npx vitest run --project browser tests/browser/legend.browser.test.ts && npm run check` — PASS.
- [ ] **Step 6: Commit** `Legend: one section per shared ScaleRef, and a No data row`.

### Task 5: Attribution starts folded on narrow maps and keeps the person's choice

**Files:**
- Modify: `src/lib/view/create-gl-map.ts` (`GlMap`, `setDataCredits`)
- Test: `tests/browser/credits.browser.test.ts` (replace `a narrow map starts with credits open and collapses on drag`)

**Interfaces:**
- Produces: nothing public. `GlMap` keeps a per-map `creditsOpen` boolean.

Folding is what MapLibre's own toggle does to close: set the container's `open` attribute and remove `maplibregl-compact-show`; opening is the reverse (`compact-show` added, `open` removed). Approach: when `addControl` adds an `AttributionControl`, watch its container (`.maplibregl-ctrl-attrib` inside `getContainer()`) with a `MutationObserver` on `class`; whenever `maplibregl-compact-show` appears and `creditsOpen` is false, fold it. A click on its `.maplibregl-ctrl-attrib-button` sets `creditsOpen` from the class after MapLibre's toggle runs; the map's `drag` clears it. `setDataCredits` opens the new control (as above) when `creditsOpen` is true. Disconnect the observer when the control is removed and with the map. Use only the documented class names and the `open` attribute.

- [ ] **Step 1: Write the failing tests:**
  - `a narrow map starts with its credits folded`: `narrow-map` → `maplibregl-compact` true, `compact-show` false, and the button is visible and named (MapLibre's "Toggle attribution").
  - `the credits button opens them by keyboard`: focus the button, `userEvent.keyboard("{Enter}")` → `compact-show` true, credits text visible.
  - `a credits change keeps folded credits folded`: data plugin whose `attribution` resolves after load (`Promise.withResolvers`) → new control, still folded.
  - `a credits change keeps opened credits open`: open by click, then credits change → new control has `compact-show`, text visible.
  - `a drag folds opened credits, and a later credits change keeps them folded`.
  - `narrowing after load stays folded`: start `wide-map`, switch class to `narrow-map`, `gl.resize()` → compact, not shown.
  - Keep `a wide map shows the full credits line` and the axe test passing.
- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/credits.browser.test.ts` — FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** the same file, then `taskset -c 0,1 npx vitest run --project browser tests/browser/credits.browser.test.ts` 3 times — PASS each time. `npm run test:bundle`.
- [ ] **Step 5: Commit** `Credits: start folded on narrow maps, and a credits change keeps the person's choice`.

### Task 6: Chevron on checkbox rows with children

**Files:**
- Modify: `src/lib/options/OptionRows.svelte` (checkbox branch, ~line 41)
- Test: `tests/browser/options-toolbar.browser.test.ts` (near `shows a checkbox's children only while it is on`, ~line 206)

- [ ] **Step 1: Write the failing tests:** `a checkbox row with children has a chevron, closed while off`: the EV row's label contains `.mapsdk-option-chevron.mapsdk-option-chevron-closed`; after checking (host values update), the chevron lacks `-closed`. `a checkbox row without children has no chevron`. The file already parks the pointer in `afterEach`.
- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/options-toolbar.browser.test.ts` — FAIL.
- [ ] **Step 3: Implement**: in the checkbox `<label>`, after the label span, when `row.children?.length`, the same chevron span as the group row (`class:mapsdk-option-chevron-closed={!on}`).
- [ ] **Step 4: Run** the same — PASS.
- [ ] **Step 5: Commit** `Options: a checkbox row with children shows the chevron`.

### Task 7: The narrow bar's search slot fills the rest of the bar

**Files:**
- Modify: `src/lib/options/OptionsToolbar.svelte` (`<style>`, `.mapsdk-options-search` under `[data-layout="narrow"]`)
- Test: `tests/browser/options-toolbar-layout.browser.test.ts` (use or add a fixture with a `search` snippet in `tests/fixtures/`)

- [ ] **Step 1: Write the failing tests:** on a 390 px map (narrow), with a search snippet rendering `<input style="width: 100%; max-width: 22.5rem">`:
  - `the narrow search slot fills the bar beside the options button`: slot width = bar width − button width − 8 px (±1); the bar is one row (slot top = button top).
  - `a full-width field caps at the room left` (input width = slot width, < 302 px).
  - `the slot's empty part lets the pointer through`: with a short child (`width: 4rem`), `document.elementFromPoint` at the slot's right end, mid-height, is not inside the slot; the child itself is hit.
  - `the wide bar's search slot is unchanged` (no `flex-grow`).
- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/options-toolbar-layout.browser.test.ts` — FAIL.
- [ ] **Step 3: Implement**: narrow only, `.mapsdk-options-search { flex: 1 1 0; min-width: 0; pointer-events: none; }` and its direct children `pointer-events: auto` (override the bar's `> *` rule for the slot).
- [ ] **Step 4: Run** the same, then `taskset -c 0,1 npx vitest run --project browser` 5 times — PASS each time.
- [ ] **Step 5: Commit** `Toolbar: the narrow bar's search slot fills the rest of the bar`.

### Task 8: Docs, e2e and the version

**Files:**
- Modify: `README.md` ("Changes", the shapes/regions/Legend/toolbar docs), `tests/unit/readme-examples.test.ts`, `CLAUDE.md` (architecture lines: plugins, presets, UI Legend, options, view credits), `package.json` and `package-lock.json` (`0.1.0-beta.15`), `e2e/demo.spec.ts`

- [ ] **Step 1: e2e test** `phone: the credits start folded and the legend is reachable`: `page.setViewportSize({ width: 390, height: 800 })`, load the demo → `.maplibregl-ctrl-attrib` has `maplibregl-compact` and not `maplibregl-compact-show`. Run `npx playwright test --project chromium --project firefox` — PASS (it fails on `main`: check once with `git stash`).
- [ ] **Step 2: README "Changes"** for `0.1.0-beta.15`: every new option with its default (`noFigure`, `regionsPlugin`'s `noFigure`/`fillOpacity`/`outline`), `LegendData`'s `scaleRef`/`scaleLabel`/`noFigure`, the new message key, the shared sections, stating plainly that sections share only when each member's data source has a `ScaleRef` as its `scale` (a literal `Scale` keeps two sections, as today), the folded credits and the kept choice, the chevron, and the narrow search slot's definite width (a field caps itself with `max-width: 100%`). No new tokens; nothing removed or renamed. Add a `regionsPlugin({ ..., noFigure: "outline" })` example and its type-check in `readme-examples.test.ts`.
- [ ] **Step 3: CLAUDE.md** architecture lines for the above.
- [ ] **Step 4: Version** `npm version 0.1.0-beta.15 --no-git-tag-version`.
- [ ] **Step 5: Run everything:** `npm run format && npm run lint && npm run check && npm test && npm run test:bundle && npm run test:licenses` — all PASS.
- [ ] **Step 6: Commit** `0.1.0-beta.15: region fills with no-figure regions, a shared Legend section, and parity fixes`.

After Task 8: a fresh whole-branch review on the most capable model, fixes, then push/PR/merge/release, each with the user's yes.

## Addendum (2026-11-15): Tasks 9-10, the monitors' detail and figure label

Spec: the spec's "Addendum" (sections 7 and 8). Constraints as above: both options unset by
default, today's look kept; no new message keys; the list gets nothing new (hosts use
`featureList={{ note }}`).

Review Focus additions:

6. `figureLabel` set with no reading ("No reading" in the box): the label still shows under it
   (Task 10 test `figure label shows with no reading`).
7. `detail` set on a monitor that has a level: the level's label wins, as in the list (Task 9
   test `a level's label wins over the detail`).

### Task 9: `monitorsPlugin` passes `detail` through, and `MonitorTooltip` shows it

**Files:**
- Modify: `src/lib/presets/monitors.ts` (`MonitorsPluginOptions`, `monitorsPlugin`)
- Modify: `src/lib/presets/MonitorTooltip.svelte`
- Test: `tests/client/presets/monitors.test.ts`, `tests/browser/monitor-tooltips.browser.test.ts`

**Interfaces:**
- Produces: `MonitorsPluginOptions.detail?(props: MonitorFeatureProperties): string | undefined`.

- [ ] **Step 1: Client tests** in `describe("monitorsPlugin detail")`: `detail` given → every
  `plugin.features!()` item's `detail` is its return value; unset → no item has `detail`.
- [ ] **Step 2: Browser tests** in `describe("MonitorTooltip")`: an item with `NO_LEVEL` and
  `detail: "Not enough data"` shows "Not enough data" and not "No level"; without a detail it shows
  "No level"; `a level's label wins over the detail` (level Moderate plus a detail → "Moderate",
  no detail text).
- [ ] **Step 3: Run both** — FAIL (no option; tooltip ignores detail).
- [ ] **Step 4: Implement:** pass `detail: options.detail` to `pointsPlugin`; in the tooltip the
  level place is `levelText(item, messages).text` (`ui/feature-list.ts`), the list's own rule.
- [ ] **Step 5: Run both** — PASS. Commit `Monitors: detail passes through to the list and the tooltip`.

### Task 10: `monitorsPlugin`'s `figureLabel` in the tooltip, and the docs

**Files:**
- Modify: `src/lib/presets/monitors.ts`, `src/lib/presets/MonitorTooltip.svelte`
- Modify: `README.md` (Changes for beta.15, the monitors paragraph), `tests/unit/readme-examples.test.ts`, `CLAUDE.md` (presets line)
- Test: `tests/browser/monitor-tooltips.browser.test.ts`, `tests/client/presets/monitors.test.ts`

**Interfaces:**
- Produces: `MonitorsPluginOptions.figureLabel?: string`; `MonitorTooltip`'s new prop
  `figureLabel?: string`.

- [ ] **Step 1: Browser tests:** `figureLabel: "24-hour average"` with `interval: "1 hour"` →
  shows "24-hour average", not "(1 hour avg)"; `figure label shows with no reading` (value null);
  unset with `interval: "1 hour"` → "(1 hour avg)" as today.
- [ ] **Step 2: Client test:** `monitorsPlugin({ ..., figureLabel })`'s `tooltip` snippet is
  rendered with `figureLabel` (mount the returned snippet's component props the way the existing
  tooltip tests reach them, or render it in a browser test through `componentSnippet`).
- [ ] **Step 3: Run** — FAIL.
- [ ] **Step 4: Implement:** the reading box's `subheading` is `figureLabel` when set, else
  today's interval line; `monitorsPlugin` passes `figureLabel` into the tooltip props.
- [ ] **Step 5: Docs:** README Changes bullet for both options (unset by default; the list note for
  the label); a `monitorsPlugin({ ..., detail, figureLabel })` example and its type-check in
  `readme-examples.test.ts`; the CLAUDE.md presets line.
- [ ] **Step 6: Run everything** (`npm run format && npm run lint && npm run check && npm test &&
  npm run test:bundle`) — PASS. Commit `Monitors: figureLabel names the figure in the tooltip`.

After Task 10: re-run the whole-branch review on the most capable model.
