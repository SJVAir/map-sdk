# "No data" for no-figure regions: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `noFigure: "outline"`, an outlined no-figure item reads "No data" (not "No level")
in the list row, its accessible name, the generic tooltip and the view summary, with the Legend's
unfilled swatch in the list.

**Architecture:** One new optional `FeatureListItem.noFigure` flag, set by `shapesPlugin` under
the same rule as its `legend()` "No data" row. The shared text helpers (`levelText`, `rowLabel`,
`summaryText`) read it, so the list and the tooltip agree.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (unit, client, browser), axe-core.

**Spec:** `docs/superpowers/specs/2026-11-15-no-figure-text-design.md`

## Global Constraints

- No new message keys and no new tokens. The text is `mapsdk_legend_no_figure` ("No data").
- No change under `noFigure: "neutral"` or unset, or in plain mode.
- Lines (LineString, MultiLineString) never get `noFigure`.
- A level's label always wins over `noFigure`; `noReading` still omits.
- Every new test is shown to fail first with the code under test temporarily undone.
- Tabs, double quotes, no trailing commas. Run `npm run format`. `npm run test:bundle` before each
  commit under `src/lib`.

## Review Focus

1. A `noFigure` item whose value has a level (a host plugin sets the flag carelessly): the level
   label wins everywhere: list, name, tooltip and summary. Covered in Task 1.
2. A `noFigure` item with a `detail`: "No data" wins, as the spec orders it. Covered in Task 1.
3. A plugin mixing outlined polygons and lines in one summary: "N No data" and "N No level" both
   appear, "No data" first. Covered in Task 1.
4. The scale changes so a region gains a level (data reload): the next `features()` drops the flag.
   Covered in Task 2.
5. Dark theme: the unfilled swatch is still seen, because its outline is `--foreground`. Covered in
   Task 3 by checking the computed outline colour against `--foreground`.

---

### Task 1: The flag and the shared text

**Files:**
- Modify: `src/lib/core/plugin.ts` (`FeatureListItem`, beside `detail`)
- Modify: `src/lib/ui/feature-list.ts` (`levelText`, `rowLabel`)
- Modify: `src/lib/ui/view-summary.ts` (`summaryText`)
- Test: `tests/unit/ui/feature-list.test.ts`, `tests/unit/ui/view-summary.test.ts`

**Interfaces:**
- Produces: `FeatureListItem.noFigure?: boolean`. The doc says: drawn as a no-figure outline
  (`shapesPlugin`'s `noFigure: "outline"`), so its level place reads "No data". Ignored when the
  item has a level. Default false.
- `levelText` keeps its signature and its kinds; a `noFigure` item gets `kind: "none"`.

- [ ] **Step 1: Write the failing tests**

In `feature-list.test.ts` (use its `item()` and `good`):
- `levelText reads No data for a noFigure item with no level`: `item(..., { level: NO_LEVEL,
  noFigure: true })` → `{ kind: "none", text: "No data" }`.
- `levelText: a level wins over noFigure`: `{ level: good, noFigure: true }` → `{ kind: "level",
  text: "Good" }`.
- `levelText: noFigure wins over detail`: `{ level: NO_LEVEL, noFigure: true, detail: "x" }` →
  text "No data".
- `levelText: noReading still omits with noFigure` → kind `"omit"`.
- `rowLabel names a no-value noFigure item "Fresno, No data"`: `{ value: null, level: NO_LEVEL,
  noFigure: true, name: "Fresno" }` → `"Fresno, No data"`.
- `rowLabel puts No data after a value`: `{ value: 5, units: "µg/m³", precision: 0, level:
  NO_LEVEL, noFigure: true }` → `"Fresno, 5 µg/m³, No data"`.
- `rowLabel without noFigure is unchanged`: the same no-value item without the flag is
  `"Fresno, no reading"`.

In `view-summary.test.ts`:
- `counts noFigure items as No data, before No level`: items Good, NO_LEVEL+noFigure ×2,
  NO_LEVEL ×1 → `"Counties: 1 Good, 2 No data, 1 No level"` (use the file's scale fixture and
  the level label it uses).
- `a noFigure item with a level counts under its level`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --project unit tests/unit/ui/feature-list.test.ts tests/unit/ui/view-summary.test.ts`
Expected: the new tests FAIL (text "No level", "no reading", no "No data" part); type errors on
`noFigure` until Step 3's field exists.

- [ ] **Step 3: Implement**

Add the field. In `levelText`, after the level check and before `detail`: `if (item.noFigure)
return { kind: "none", text: messages("mapsdk_legend_no_figure") }`. Update its doc comment. In
`rowLabel`'s no-value branch, use `mapsdk_list_row_level` with `level.text` also when
`item.noFigure` and `level.kind === "none"`. In `summaryText`, count unlevelled `noFigure` items
separately; push `"N No data"` (`mapsdk_legend_no_figure`) before `"N No level"`. Update its doc
comment.

- [ ] **Step 4: Run them and see them pass, then prove they bite**

Run the Step 2 command; expect PASS. Temporarily remove the `levelText` line, then the
`summaryText` count, and check the matching tests fail. Restore.

- [ ] **Step 5: Commit**

`git commit -m "List text: a noFigure item reads No data in its level place, name and the summary"`

### Task 2: shapesPlugin sets the flag

**Files:**
- Modify: `src/lib/plugins/shapes.svelte.ts` (`features()`; share the rule with `legend()`)
- Test: `tests/client/plugins/shapes.test.ts` (`describe("shapesPlugin noFigure")`)

**Interfaces:**
- Consumes: `FeatureListItem.noFigure` (Task 1).
- Produces: a module-local predicate `drawnAsNoFigure(feature, scale): boolean` (no line geometry
  and `levelFor(value, scale) === NO_LEVEL`), used by both `legend()` and `features()`, so the two
  can't drift.

- [ ] **Step 1: Write the failing tests** (in the noFigure describe, using `POLYGONS`,
  `WITH_LEVELS` and the line collection from the "lines out of the No data flag" test)
- `features() flags outlined polygons with no level`: `noFigure: "outline"`, POLYGONS → Alpha's
  item has `noFigure: true`, and Bravo's item has no `noFigure` key.
- `features() never flags lines`: the mixed collection → the Line item has no `noFigure`.
- `features() flags nothing under neutral, unset or plain mode`: loop `undefined`, `"neutral"`,
  and `mode: "plain"` with `"outline"` → no item has `noFigure`.
- `features() flags nothing while the scale is unresolved`: a source with no scale resolved
  yet (follow the file's pattern for a pending scale) → no `noFigure`.
- `features() drops the flag once the feature has a level`: set `source.features = WITH_LEVELS`,
  `flushSync()` → no `noFigure`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --project client tests/client/plugins/shapes.test.ts`
Expected: the first test FAILS (`noFigure` undefined). The others may pass now. They guard against
the flag being set too widely, so check them again in Step 4.

- [ ] **Step 3: Implement**

Extract `drawnAsNoFigure` and use it in `legend()`. In `features()`, spread
`...(outlineNoFigure && scale && drawnAsNoFigure(feature, scale) && { noFigure: true })`.

- [ ] **Step 4: Run them and see them pass, then prove they bite**

Run the Step 2 command; expect PASS. Temporarily drop the line check from `drawnAsNoFigure`, and
then the `outlineNoFigure` guard. Check that "never flags lines" and "flags nothing under neutral"
fail. Restore.

- [ ] **Step 5: Commit**

`git commit -m "Shapes: outlined no-figure items carry noFigure, by the legend's rule"`

### Task 3: The list swatch, and the list and tooltip in the browser

**Files:**
- Modify: `src/lib/ui/FeatureList.svelte` (swatch class `nofigure`; style beside
  `.mapsdk-list-swatch.neutral`)
- Test: `tests/browser/feature-list.browser.test.ts`, `tests/browser/tooltip.browser.test.ts`

**Interfaces:**
- Consumes: `FeatureListItem.noFigure` and `levelText` (Task 1).

- [ ] **Step 1: Write the failing tests**

In `feature-list.browser.test.ts` (its `item()`/`listed()`/`newMap()`):
- `a noFigure row reads No data with an unfilled swatch`: one item `{ value: null, level:
  NO_LEVEL, noFigure: true, name: "Fresno" }` → the option's accessible name is `"Fresno, No
  data"`, the row's text contains "No data" and not "No level", and its
  `.mapsdk-list-swatch` has computed `background-color` `rgba(0, 0, 0, 0)` and an outline colour
  equal to the resolved `--foreground`.
- `a noFigure row has no axe violations`: `axe.run(document.querySelector(".mapsdk-list")!)` →
  no violations.

In `tooltip.browser.test.ts`, next to `shows No level for NO_LEVEL` (same setup):
- `shows No data for a noFigure item`: tooltip text `"Gray 12.34 µg/m³ No data"`. Also run axe on
  the tooltip and expect no violations.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run --project browser tests/browser/feature-list.browser.test.ts tests/browser/tooltip.browser.test.ts`
Expected: the swatch test FAILS (muted background). The text assertions pass already through
Task 1. Prove they bite by temporarily undoing Task 1's `levelText` line, then restore.

- [ ] **Step 3: Implement**

`class:nofigure={row.noFigure && !level}` on the swatch. `.mapsdk-list-swatch.nofigure {
background: transparent; }` after the `.neutral` rule.

- [ ] **Step 4: Run them and see them pass**

Run the Step 2 command, then `taskset -c 0,1 npx vitest run --project browser` three times.
Expected: PASS each time.

- [ ] **Step 5: Commit**

`git commit -m "List: an outlined no-figure row shows the Legend's unfilled swatch"`

### Task 4: Version, docs, and the full check

**Files:**
- Modify: `package.json` and `package-lock.json` (`0.1.0-beta.16`, via `npm version
  0.1.0-beta.16 --no-git-tag-version`)
- Modify: `README.md` ("Plugins and draw order" `noFigure` paragraph near line 220; the
  `FeatureListItem` `detail` paragraph near line 288; a new "### 0.1.0-beta.16" under "Changes")
- Modify: `CLAUDE.md` (Plugins: `shapesPlugin` sets `noFigure` on outlined items; UI:
  `levelText`/`summaryText` read "No data" for them)
- Test: `tests/unit/readme-examples.test.ts` only if an example changes (none expected)

- [ ] **Step 1: Write the docs.** The Changes entry describes this change from map-sdk's side
  only: under `noFigure: "outline"`, outlined no-figure items read "No data" in the list, row
  names, generic tooltip and view summary, with an unfilled list swatch; the new
  `FeatureListItem.noFigure`; no change under `"neutral"`; exports otherwise unchanged; no new
  keys or tokens.
- [ ] **Step 2: Run the full check**

Run: `npm run format && npm run lint && npm run check && npm test && npm run test:bundle && npm run test:licenses && npx playwright test --project chromium --project firefox`
Expected: all pass.

- [ ] **Step 3: Commit**

`git commit -m "0.1.0-beta.16: README, CLAUDE.md and version"`
