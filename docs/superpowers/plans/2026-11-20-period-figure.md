# The period figure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@sjvair/map-sdk` `0.1.0-beta.22`: build on `@sjvair/sdk` `5.0.0-beta.15`, let
`monitorsPlugin` take a host legend line, and let a region layer name its no-figure state and give
each no-figure region a reason.

**Architecture:** The SDK move is a pin plus two `null` keys on literal `Scale`s. The legend line
is a pass-through of the existing `hostLegend` options. The label and reason ride on
`FeatureListItem` (`noFigureLabel`, `detail`) and `LegendData` (`noFigureLabel`), set by
`shapesPlugin` and drawn by the shared UI (`levelText`, `rowLabel`, `summaryText`, `TooltipItem`,
`Legend`), so every host of those components gets them.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (unit / client / browser), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-20-period-figure-design.md`

## Global Constraints

- Dev pin exactly `"@sjvair/sdk": "npm:@jsr/sjvair__sdk@5.0.0-beta.15"`; peer range stays
  `"npm:@jsr/sjvair__sdk@^5.0.0-beta.2"`.
- Hosts that set none of the new options see no change, apart from the new message key.
- One new message key only: `"mapsdk_list_row_level_detail": "{name}, {level}, {detail}"`.
- `noFigureLabel` applies only under `noFigure: "outline"`; `detail` and `noFigureLabel` are
  trimmed, and empty means unset; `detail` is ignored on an item with a level.
- `figureLabel` never appears in the legend.
- A shared legend section takes the first member's `noFigureLabel` that is set (as `unitsLine`
  and `note`).
- No Claude/AI attribution and no `Co-Authored-By` / `Claude-Session` trailers in commits or the
  PR. Commits are GPG-signed; never commit unsigned.
- Run `npm run check` before each commit, and `npm run test:bundle` before committing a change
  under `src/lib`. `npm run format` before committing.
- Each new test is seen to fail before its code exists (or, for a guard that passes at once, with
  the code under test temporarily undone). Each task says which tests fail first.

## Review Focus

1. Whitespace-only `noFigureLabel` or `detail` (`"  "`): reads as unset ("No data", no reason
   line), never an empty chip or a trailing ", ". Tests in Tasks 2 and 4.
2. `noFigureLabel` set under `noFigure: "neutral"` (or unset): no item gets the label, the legend
   has no row, and a no-level region reads "No level" (or its `detail`). Test in Task 4.
3. A `null` source scale under `noFigure: "outline"`: every polygon is flagged and carries the
   label and reason, but there is no legend section. Test in Task 4.
4. A shared section where only the regions member sets `noFigureLabel` (monitors first in order):
   the shared row reads the regions' label. Test in Task 3.
5. A `noFigure` item that has a value (off every level) with a `detail`: accessible name stays
   "Fresno, 5 µg/m³, Not enough data"; the tooltip still shows the reason. Tests in Task 2.

---

### Task 1: Move to `@sjvair/sdk` `5.0.0-beta.15`

**Files:**
- Modify: `package.json` (devDependencies only), `package-lock.json`
- Modify: `src/lib/plugins/scale-resolution.svelte.ts` (`NO_SCALE`), `tests/fixtures/scales.ts`,
  `demo/pesticide-data.ts`, and any other literal `Scale` `npm run check` reports

**Interfaces:** Produces: every literal `Scale` has `period_statistic: null` and
`period_statistic_label: null` right after `daily_statistic_label`.

- [ ] **Step 1:** Set the dev pin and run `npm install`.
- [ ] **Step 2:** Run `npm run check`. Expected: FAIL, errors naming `period_statistic` on each
  literal `Scale` (this is the failing test for this task).
- [ ] **Step 3:** Add both keys as `null` after `daily_statistic_label` in each reported literal.
- [ ] **Step 4:** Run `npm run check` and `npm test`. Expected: 0 errors; all tests pass.
- [ ] **Step 5:** `npm run test:bundle`, then commit: "Move to @sjvair/sdk 5.0.0-beta.15".

### Task 2: The label and reason in the list, tooltip and summary

**Files:**
- Modify: `src/lib/core/plugin.ts` (`FeatureListItem`), `src/lib/ui/feature-list.ts`
  (`levelText`, `rowLabel`), `src/lib/ui/view-summary.ts`, `src/lib/ui/TooltipItem.svelte`,
  `src/lib/data/messages/en.json`
- Test: `tests/unit/ui/feature-list.test.ts`, `tests/unit/ui/view-summary.test.ts`,
  `tests/browser/tooltip.browser.test.ts`, `tests/browser/feature-list.browser.test.ts`

**Interfaces:**
- Produces: `FeatureListItem.noFigureLabel?: string` (doc: the text in place of "No data" on a
  `noFigure` item; ignored without `noFigure` or with a level). `FeatureListItem.detail`'s doc:
  on a `noFigure` item it sits beside the label (accessible name, tooltip) instead of being
  ignored.
- Produces: `levelText(item, messages): { kind: "level" | "detail" | "none" | "omit"; text:
  string; detail?: string }`. For a `noFigure` item with no level: `kind: "none"`, `text` = the
  trimmed `noFigureLabel` else `mapsdk_legend_no_figure`, and `detail` = the trimmed `detail` when
  non-empty (key absent otherwise). Every other case is unchanged and has no `detail` key.

- [ ] **Step 1: Write the failing tests** (unit, `feature-list.test.ts`):
  - `levelText` "reads a noFigure item's noFigureLabel in place of No data":
    `{ level: NO_LEVEL, noFigure: true, noFigureLabel: "Not enough data" }` →
    `{ kind: "none", text: "Not enough data" }`.
  - "carries a noFigure item's detail beside its label": add `detail: "Only 3 of 30 days had a
    figure"` → `{ kind: "none", text: "Not enough data", detail: "Only 3 of 30 days had a figure" }`.
  - "treats a blank noFigureLabel and detail as unset": `noFigureLabel: "  ", detail: " "` →
    `{ kind: "none", text: "No data" }` (`toEqual`, so no `detail` key).
  - "ignores noFigureLabel without noFigure": `{ level: NO_LEVEL, noFigureLabel: "X" }` →
    `{ kind: "none", text: "No level" }`.
  - Rewrite "gives noFigure's No data over a detail" to expect
    `{ kind: "none", text: "No data", detail: "x" }`.
  - `rowLabel` "names a no-value noFigure item with its label and detail":
    `{ value: null, level: NO_LEVEL, noFigure: true, noFigureLabel: "Not enough data", detail:
    "Only 3 of 30 days had a figure" }` → `"Fresno, Not enough data, Only 3 of 30 days had a
    figure"`.
  - `rowLabel` "uses the label alone without a detail" → `"Fresno, Not enough data"`.
  - `rowLabel` "keeps a valued noFigure item's name without the detail": `{ value: 5, precision:
    0, level: NO_LEVEL, noFigure: true, noFigureLabel: "Not enough data", detail: "x" }` →
    `"Fresno, 5 µg/m³, Not enough data"` (guard).
  - `view-summary.test.ts` "counts noFigure items under their noFigureLabel": two outlined items
    with `noFigureLabel: "Not enough data"` → the summary contains `"2 Not enough data"` and not
    `"No data"`.
- [ ] **Step 2:** `npm run test:unit -- feature-list view-summary`. Expected: the new tests FAIL
  (label reads "No data"; no `detail` key; "Fresno, No data"); the valued-item guard passes.
- [ ] **Step 3: Implement.** `FeatureListItem.noFigureLabel`; `levelText` as in Interfaces;
  `rowLabel`'s no-value `noFigure` branch uses `mapsdk_list_row_level_detail` with
  `{ name, level: level.text, detail: level.detail }` when `level.detail` is set; `summaryText`
  counts `noFigure` items by their label (a `Map<label, count>`, in first-seen order, after the
  levels and before "No level"); add the key to `en.json` after `mapsdk_list_row_detail`.
- [ ] **Step 4:** Run the unit tests again. Expected: PASS. Temporarily make `levelText` drop the
  `detail` and see the detail tests fail, then restore.
- [ ] **Step 5: Browser tests.** `tooltip.browser.test.ts` "shows a noFigure item's label chip
  with its detail under it, with no axe violations": item with `noFigure`, `noFigureLabel: "Not
  enough data"`, `detail: "Only 3 of 30 days had a figure"` → `getByText("Not enough data")` and
  `getByText("Only 3 of 30 days had a figure")` both visible, the label before the detail in DOM
  order, axe clean on the tooltip root. `feature-list.browser.test.ts` "shows a noFigure row's
  label, not its detail, and names both": the row's visible level text is "Not enough data", the
  page has no visible "Only 3 of 30 days had a figure", and the option's accessible name is
  "Fresno, Not enough data, Only 3 of 30 days had a figure"; axe clean.
- [ ] **Step 6:** `npx vitest run --project browser tooltip feature-list`. Expected: the tooltip
  test FAILS (no detail line); the list test passes once Step 3 is in (it rides on `rowLabel`;
  confirm it fails with Step 3's `rowLabel` change undone).
- [ ] **Step 7: Implement `TooltipItem`:** after the chip, when `levelPlace.detail` is set, a
  `<span class="mapsdk-tooltip-detail text-xs">` with it. The list row draws `levelPlace.text`
  already; no `FeatureList.svelte` change expected.
- [ ] **Step 8:** Run both projects' specs; `npm run check`; `npm run test:bundle`; commit:
  "No-figure items: a host label and reason in the list, tooltip and summary".

### Task 3: The label in the Legend

**Files:**
- Modify: `src/lib/core/plugin.ts` (`LegendData`'s scale variant), `src/lib/ui/legend-data.ts`
  (`LegendSection`, the section builder, `shareSections`), `src/lib/ui/Legend.svelte`
- Test: `tests/unit/ui/legend-data.test.ts`, `tests/browser/legend.browser.test.ts`

**Interfaces:**
- Produces: `LegendData` scale variant `noFigureLabel?: string` (doc: the text of the "No data"
  row, with `noFigure`). `LegendSection.noFigureLabel?: string`, copied when set.

- [ ] **Step 1: Failing tests.** `legend-data.test.ts`: "carries noFigureLabel onto the section";
  "a shared section takes the first noFigureLabel that is set": entries monitors (`scaleRef:
  PM25`, no label) then regions (`scaleRef: PM25, noFigure: true, noFigureLabel: "Not enough
  data"`) → the shared section's `noFigureLabel` is "Not enough data". `legend.browser.test.ts`:
  "labels the no-figure row with the section's noFigureLabel": a scale entry with `noFigure:
  true, noFigureLabel: "Not enough data"` → the section shows "Not enough data" and no "No data";
  axe clean. Guard: the existing "ends the section with a No data row" still reads "No data".
- [ ] **Step 2:** Run them. Expected: the three new tests FAIL.
- [ ] **Step 3: Implement:** copy the field in the section builder; in `shareSections`,
  `item.find((s) => s.noFigureLabel)?.noFigureLabel`, spread in when set; `Legend.svelte`'s row
  shows `section.noFigureLabel ?? map.messages("mapsdk_legend_no_figure")`.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** `npm run check`; `npm run test:bundle`; commit: "Legend: a section's no-figure
  row takes the host's label".

### Task 4: `shapesPlugin` and `regionsPlugin` options

**Files:**
- Modify: `src/lib/plugins/shapes.svelte.ts`, `src/lib/presets/regions.ts`
- Test: `tests/client/plugins/shapes.test.ts`, `tests/client/presets/shapes-presets.test.ts`

**Interfaces:**
- Consumes: `FeatureListItem.noFigureLabel` (Task 2), `LegendData.noFigureLabel` (Task 3).
- Produces: `ShapesOptions<P>.detail?(props: P): string | undefined` and
  `ShapesOptions<P>.noFigureLabel?: string`, documented as in the spec.
  `RegionsPluginOptions` gains `detail?(props: MapFeatureProperties): string | undefined`,
  `noFigureLabel?: string`, `legendUnits?: string`, `legendNote?: Snippet`, all passed through.

- [ ] **Step 1: Failing tests** (`shapes.test.ts`, a new `describe("shapesPlugin detail and
  noFigureLabel")`, using `POLYGONS` with `smokeScale` as the existing noFigure tests do):
  - "puts the label and detail on outlined no-figure items": `noFigure: "outline",
    noFigureLabel: "Not enough data", detail: (p) => \`why ${p.name}\`` → each no-level polygon
    item has `noFigure: true`, `noFigureLabel: "Not enough data"`, `detail: "why <name>"`; a
    levelled item has neither `noFigureLabel` nor `detail`.
  - "the legend's no-figure row carries the label": `plugin.legend()` matches `{ noFigure: true,
    noFigureLabel: "Not enough data" }`.
  - "ignores noFigureLabel under neutral" (Review Focus 2): `noFigure: "neutral"` with the label
    → no item has `noFigureLabel`; `"noFigureLabel" in plugin.legend()` is false; a `detail` still
    lands on no-level items.
  - "trims, and a blank label or detail is unset" (Review Focus 1): `noFigureLabel: " ",
    detail: () => "  "` → no item has either key.
  - "a null scale flags and labels every polygon, with no legend" (Review Focus 3): source
    `scale: null`, `noFigure: "outline"`, label and detail set → every polygon item has
    `noFigure`, the label and the detail; `plugin.legend()` is null.
  - `shapes-presets.test.ts`: "passes detail, noFigureLabel, legendUnits and legendNote to the
    shapes": `regionsPlugin({ …, noFigure: "outline", noFigureLabel: "Not enough data", detail:
    () => "x", legendUnits: "µg/m³ · monthly", legendNote: note })` → items carry label and
    detail; the legend has `unitsLine: "µg/m³ · monthly"`, `note`, and `noFigureLabel`.
- [ ] **Step 2:** `npx vitest run --project client shapes`. Expected: the new tests FAIL (the
  neutral guard's detail part fails too, as `shapesPlugin` has no `detail` yet).
- [ ] **Step 3: Implement.** In `features()`, compute `detail` (trimmed, only for items with no
  level) and add `noFigureLabel` (trimmed, once at setup) to items flagged `noFigure`; in
  `legend()`, add `noFigureLabel` with `noFigure: true`. `regionsPlugin` passes the four options.
- [ ] **Step 4:** Run them. Expected: PASS. Temporarily drop the `legend()` label to see that test
  fail, then restore.
- [ ] **Step 5:** `npm run check`; `npm run test:bundle`; commit: "shapesPlugin and regionsPlugin:
  detail and noFigureLabel; regionsPlugin passes the legend line through".

### Task 5: `monitorsPlugin`'s `legendUnits` and `legendNote`

**Files:**
- Modify: `src/lib/presets/monitors.ts`
- Test: `tests/client/presets/monitors.test.ts`, `tests/browser/legend.browser.test.ts`

**Interfaces:** Produces: `MonitorsPluginOptions.legendUnits?: string`,
`MonitorsPluginOptions.legendNote?: Snippet`, passed to `pointsPlugin`.

- [ ] **Step 1: Failing tests.** `monitors.test.ts`, in "monitorsPlugin legend title" (it has a
  metadata `scale` and `ScaleRef`, so a real section): "carries legendUnits and legendNote" →
  `plugin.legend()` has `unitsLine` and `note` as given; "leaves them out when unset" (guard) →
  no `unitsLine`/`note` keys; "keeps figureLabel out of the legend" (guard) → with `figureLabel`
  only, no `unitsLine`/`note`. `legend.browser.test.ts`: "a shared PM2.5 section shows the
  monitors' units line for both layers": a monitors entry with `unitsLine: "µg/m³ · Average of
  daily means"` and a regions entry on the same `scaleRef` with `noFigure: true` → one section,
  the line visible once, the no-figure row present.
- [ ] **Step 2:** Run them. Expected: "carries legendUnits and legendNote" FAILS; the guards pass
  (show each fails with the option forwarded unconditionally / `figureLabel` forwarded as
  `legendUnits`, then restore); the browser test passes on today's sharing (a guard; show it
  fails with `shareSections`' `unitsLine` line removed, then restore).
- [ ] **Step 3:** Add both options with `pointsPlugin`'s doc comments, plus a sentence that
  `figureLabel` doesn't reach the legend, and pass them through.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** `npm run check`; `npm run test:bundle`; commit: "monitorsPlugin: legendUnits and
  legendNote".

### Task 6: The demo and e2e

**Files:**
- Modify: `demo/App.svelte` (the Monitors and Region fill presets), `demo/date-range-source.svelte.ts`
  (the regions loader), `e2e/fixtures/regions-pm25-summaries-daily.json`, `e2e/demo.spec.ts`

**Interfaces:** Consumes Tasks 4–5's options.

- [ ] **Step 1: Fixture and failing e2e.** Give Madera County (`4fjmg`) an empty `summaries`
  list, so it has no figure (no other e2e test reads Madera). New e2e test "a no-figure county
  reads Not enough data with its reason": enable Region fill, zoom to Madera, open the Left map's
  list → the Madera row's accessible name is "Madera County, Not enough data, No day in the range
  had a figure"; hover or click it → the card shows "Not enough data" and the reason; the
  Date-range legend shows a "Not enough data" row and the PM2.5 section's line "µg/m³ · Average
  of the range's daily means". Update `LEGEND_SECTIONS` / heading checks only if the units line
  changes a heading's accessible name.
- [ ] **Step 2:** `npx playwright test --project chromium -g "no-figure county"`. Expected: FAIL.
- [ ] **Step 3: Demo.** The regions loader adds the reason as a feature property
  (`reason: string | null`): days with a non-null `mean` against the range's days — "Only {n} of
  {d} days had a figure", or "No day in the range had a figure" when none (demo text; the demo
  isn't shipped and needs no message keys). Region fill: `noFigure: "outline"`, `noFigureLabel:
  "Not enough data"`, `detail: (p) => p.reason ?? undefined`. Monitors (Date-range map only, not
  `today-options.svelte.ts`): `legendUnits: "µg/m³ · Average of the range's daily means"`.
- [ ] **Step 4:** Run the new test, then the whole suite on Chromium and Firefox
  (`npx playwright test --project chromium --project firefox`). Expected: PASS (the axe scans
  include the new row and card).
- [ ] **Step 5:** `npm run check`; `npm run lint`; commit: "Demo: a no-figure county's label and
  reason, and the monitors legend line".

### Task 7: Docs and the version

**Files:**
- Modify: `README.md`, `tests/unit/readme-examples.test.ts`, `CLAUDE.md`, `package.json`
  (`version` → `0.1.0-beta.22`), `package-lock.json`

- [ ] **Step 1:** README examples test first: a `regionsPlugin` example with `noFigure:
  "outline"`, `noFigureLabel`, `detail`; a `monitorsPlugin` example with `legendUnits`; a
  `FeatureListItem` with `noFigureLabel`. `npm run check` FAILS until the README carries the
  matching examples (as the test's existing pattern requires).
- [ ] **Step 2:** README: the monitors section (`legendUnits` / `legendNote`, and that
  `figureLabel` stays out of the legend); the regions/shapes no-figure section (`noFigureLabel`,
  `detail`, the table of where each shows, the shared-section rule); the `FeatureListItem`
  paragraph; the `### 0.1.0-beta.22` "Changes" entry: the SDK dev pin and unchanged peer range,
  every new option and field, and **the new message key `mapsdk_list_row_level_detail`: a host
  that types its messages as `Record<MessageKey, …>` adds it when it moves to this beta**. Token
  list: no new tokens (say nothing).
- [ ] **Step 3:** CLAUDE.md architecture lines: `shapesPlugin`'s `detail` / `noFigureLabel`,
  `regionsPlugin`'s pass-throughs, `monitorsPlugin`'s `legendUnits` / `legendNote`, the
  `FeatureListItem.noFigureLabel` line in UI.
- [ ] **Step 4:** Bump the version (`npm version 0.1.0-beta.22 --no-git-tag-version`).
- [ ] **Step 5:** `npm run check`, `npm run lint`, `npm test`, `npm run test:bundle`,
  `npm run test:licenses`. Expected: all pass. Commit: "0.1.0-beta.22: the period figure".

### After the tasks

Whole-branch review on the most capable model (budget two rounds), browser project 5–6 times
under `taskset -c 0,1` if a hover test changed, then ask the user to push.
