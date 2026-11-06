# Frameless Legend and list detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Legend` takes `framed={false}` to drop its card, and a feature with no level can carry
a `detail` text that replaces "No level" in the feature list and map-sdk's generic tooltip.

**Architecture:** `FeatureListItem` gains an optional `detail`. A shared helper decides what
stands in a level's place (`level label` | `detail` | "No level"), used by the list row, its
accessible name, and `TooltipItem`. `pointsPlugin` fills `detail` from a new `detail(props)`
option. `Legend` gets a `framed` prop; when false, its CSS frame is off and it resolves the
background its swatches blend over from the nearest opaque ancestor.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (unit, client, browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-legend-frame-and-list-detail-design.md` (approved
2026-11-06). Read it first.

## Global Constraints

- Nothing changes for a plugin with a scale, for an item with a level, or for `Legend` with no
  options.
- A level wins over a detail: `detail` only replaces the "No level" fallback.
- The detail is plain text (no swatch, no chip). Text is the host's; map-sdk's only new string is
  `mapsdk_list_row_detail`: `"{name}, {detail}"` in `src/lib/data/messages/en.json`.
- Theme tokens only. Tabs, double quotes, no trailing commas, 100 columns; `npm run format`
  before each commit. `npm run test:bundle` before committing anything under `src/lib`.
- Commits carry no AI attribution. No push, PR, merge, tag or publish without the user's yes.

## Review Focus

1. **An empty `detail` (`""`)** is treated as no detail: "No level" shows, never a blank chip
   place or "Name, " as the accessible name. Test in Task 1.
2. **A detail on an item with a value but no level** (not EV's case): the row reads "Name, 5 µg/m³,
   detail" and shows the value. Test in Task 1.
3. **A frameless legend with no opaque ancestor** (the host's card is transparent too): swatches
   blend over the `--background` token, not black. Test in Task 4.
4. **The host's card color changes with the theme** (light ↔ dark): the frameless legend re-reads
   the ancestor's color on the theme change, as the framed one re-reads its own. Test in Task 4.
5. **`framed` changed after mount:** the frame and the blend background follow. Test in Task 4.

---

### Task 1: `detail` on list items: type, shared wording, list row and accessible name

**Files:**

- Modify: `src/lib/core/plugin.ts` (`FeatureListItem`, near line 46)
- Modify: `src/lib/ui/feature-list.ts` (`rowLabel` near line 80; add `levelText`)
- Modify: `src/lib/ui/FeatureList.svelte` (the `.mapsdk-list-level` span near line 362)
- Modify: `src/lib/data/messages/en.json`
- Test: `tests/unit/ui/feature-list.test.ts`, `tests/browser/feature-list.browser.test.ts`

**Interfaces:**

- Produces:
  - `FeatureListItem.detail?: string`, documented: "A short text about a feature with no level
    (e.g. "Level 2 charger"), shown where its level would be. Ignored when the item has a level."
  - `export function levelText(item: FeatureListItem, messages: MessageProvider): { text: string; kind: "level" | "detail" | "none" }`
    in `feature-list.ts`: the level's label (`"level"`), else a non-empty `detail` (`"detail"`),
    else `messages("mapsdk_no_level")` (`"none"`).
  - Message key `mapsdk_list_row_detail`: `"{name}, {detail}"`.

- [ ] **Step 1: Failing unit tests** in `tests/unit/ui/feature-list.test.ts`, `describe("rowLabel")`
      and a new `describe("levelText")`, using the file's `item(...)` helper:
  - `rowLabel` of `{ name: "Fresno Station", value: null, level: NO_LEVEL, detail: "Level 2 charger" }`
    is `"Fresno Station, Level 2 charger"`.
  - With `value: 5`, units `"µg/m³"`, `level: NO_LEVEL`, `detail: "Level 2 charger"`:
    `"Fresno Station, 5 µg/m³, Level 2 charger"` (Review Focus 2).
  - With a real level and a detail: the level's label, not the detail.
  - With `detail: ""` and `value: null`: `"Fresno Station, no reading"` (Review Focus 1).
  - `levelText` returns `{ kind: "level" }`, `{ kind: "detail", text: "Level 2 charger" }`, and
    `{ kind: "none", text: "No level" }` for those cases.
- [ ] **Step 2: Failing browser test** in `feature-list.browser.test.ts`:
      "shows a detail in the level's place, with no swatch": items `Arvin` (NO_LEVEL,
      `detail: "Level 2 charger"`, `value: null`) and `Bakersfield` (NO_LEVEL, no detail). The
      option named `"Arvin, Level 2 charger"` exists; its `.mapsdk-list-level` text is
      `"Level 2 charger"` with no `.mapsdk-list-swatch`; its value cell is empty; Bakersfield still
      shows "No level" with a neutral swatch.
- [ ] **Step 3: Run** `npx vitest run --project unit tests/unit/ui/feature-list.test.ts` and
      `npx vitest run --project browser tests/browser/feature-list.browser.test.ts`. Expected:
      the new tests FAIL.
- [ ] **Step 4: Implement** the type, `levelText`, the message, `rowLabel` (null value + detail →
      `mapsdk_list_row_detail`; otherwise `levelText(...).text` in the `{level}` slot), and the
      row markup (swatch only when `kind !== "detail"`).
- [ ] **Step 5: Run** both commands, then `npm run check`. Expected: PASS, 0 errors.
- [ ] **Step 6: Commit** `git commit -m "FeatureListItem.detail: shown in place of No level in the list"`.

### Task 2: `detail` in map-sdk's generic tooltip

**Files:**

- Modify: `src/lib/ui/TooltipItem.svelte`
- Test: `tests/browser/tooltip.browser.test.ts`

**Interfaces:**

- Consumes: `levelText` (Task 1).

- [ ] **Step 1: Failing tests**, next to "shows No level for NO_LEVEL":
  - "shows a detail as plain text in place of the chip": `item("a", "Fresno Station", NO_LEVEL)`
    with `value: null` and `detail: "Level 2 charger"` → tooltip text is
    `"Fresno Station Level 2 charger"`; no `.mapsdk-tooltip-chip` in the tooltip; an element with
    class `mapsdk-tooltip-detail` holds the text.
  - "a level wins over a detail": a real level and a detail → the chip with the level's label.
- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/tooltip.browser.test.ts`.
      Expected: FAIL.
- [ ] **Step 3: Implement:** for `kind === "detail"`, render
      `<span class="mapsdk-tooltip-detail text-xs">{text}</span>` instead of the chip; otherwise
      today's chip with `levelText(...).text`.
- [ ] **Step 4: Run** the file and `npm run test:browser`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Tooltip: a feature's detail in place of No level"`.

### Task 3: `pointsPlugin`'s `detail` option

**Files:**

- Modify: `src/lib/plugins/points.svelte.ts` (`PointsOptions` near line 100; `features()` near
  line 208)
- Test: `tests/client/plugins/points.test.ts`

**Interfaces:**

- Produces: `PointsOptions<P>.detail?(props: P): string | undefined`, documented: "A short text
  for a feature with no level (e.g. "Level 2 charger"), shown in the list and tooltip where
  "No level" would be."

- [ ] **Step 1: Failing client tests:**
  - "detail feeds each listed feature": `setup({ source, detail: (p) => \`detail ${p.name}\` })`
    → `plugin.features!().map((f) => f.detail)` equals `["detail A", "detail B"]` for two rows.
  - "no detail option, no detail": `features()` items have no `detail` property.
- [ ] **Step 2: Run** `npx vitest run --project client tests/client/plugins/points.test.ts`.
      Expected: FAIL.
- [ ] **Step 3: Implement:** in `features()`, add `detail` only when the option returns a
      non-empty string (`...(text ? { detail: text } : {})`).
- [ ] **Step 4: Run** it again, then `npm run check && npm run test:bundle`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "pointsPlugin detail option"`.

### Task 4: `Legend` `framed`

**Files:**

- Modify: `src/lib/ui/Legend.svelte`
- Test: `tests/browser/legend.browser.test.ts`

**Interfaces:**

- Produces: `Legend` prop `framed?: boolean` (default `true`), documented as in the spec.

Background rule (spec, "What a frameless legend's swatches blend over"): framed → the root's own
computed background, as today. Frameless → walk `root.parentElement` upward and take the first
element whose computed `background-color` has alpha 1 (read the alpha from the same 1×1 canvas,
`getImageData(...).data[3] === 255`); if none, resolve the `--background` token through a hidden
probe element (`style="position:absolute;visibility:hidden;background:var(--background)"`
appended to the root, read, removed). Re-run on theme changes (the existing `watchTheme`) and
when `framed` changes.

- [ ] **Step 1: Failing tests** (`describe("framed={false}")`), rendering `Legend` inside a
      300px-wide wrapper `div`:
  - "draws no frame and fills its container": the `.mapsdk-legend` region has computed
    `border-top-width` `"0px"`, `padding-top` `"0px"`, `box-shadow` `"none"`,
    `background-color` `"rgba(0, 0, 0, 0)"`, and width 300; its sections still render (the
    "PM2.5" heading, block labels).
  - "blends translucent blocks over the host's card": wrapper `background: rgb(255, 255, 255)`
    under `applyTheme("dark")`; the third block (the one the existing "mixes a translucent block
    over the background token" test uses) has a red channel **greater** than `0x33` (mixed over
    white, not near-black or black).
  - "falls back to the background token with no opaque ancestor" (Review Focus 3): transparent
    wrapper, `applyTheme("dark")` → red channel `< 0x33`, and not `0` for every channel.
  - "re-reads the card on a theme change" (Review Focus 4): wrapper `background: var(--card)`
    with `--card` set per theme by the test; switch light → dark; the block's color changes.
  - "follows framed after mount" (Review Focus 5): render framed, `rerender({ framed: false })`
    → no border; back to `true` → border width `"1px"`.
  - Default unchanged: computed width `336px` (21rem) and a 1px border.
- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/legend.browser.test.ts`.
      Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the prop (a class such as `mapsdk-legend-frameless` that sets
      border, padding, background, radius and shadow to none and width to auto) and the
      background rule.
- [ ] **Step 4: Run** the file and `npm run test:browser`. Expected: PASS.
- [ ] **Step 5: Run** `npm run check && npm run lint && npm run test:bundle`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Legend framed={false}: no card of its own"`.

### Task 5: Demo, docs, and screenshots

**Files:**

- Modify: `demo/App.svelte` (the "Monitor-map setup map" section), `README.md` (the `Legend`
  section, `pointsPlugin` options, `FeatureListItem` in "Writing a plugin"),
  `tests/unit/readme-examples.test.ts`, `CLAUDE.md` (UI bullet: `Legend` `framed`; Plugins
  bullet: `detail`)

- [ ] **Step 1: Demo:** a checkbox "Legend in a host card" (default off) on the setup map that
      wraps `<Legend map={today} order="top-first" framed={false} />` in a simple demo card
      (`background: var(--card, var(--background))`, a border, padding, and a "Legend" heading);
      and a checkbox "Sample EV chargers" (default off) that adds a small static
      `pointsPlugin` (no scale; three points near Fresno; `detail` "Level 2 charger" /
      "Level 3 charger") to the setup map. Defaults keep today's demo.
- [ ] **Step 2: Docs** as listed, plus a `readme-examples` test that types a `pointsPlugin`
      call with `detail` and a `FeatureListItem` with `detail`.
- [ ] **Step 3: Run** `npm run check && npm run lint && npm test && npm run test:bundle` and
      `npx playwright test --project chromium --project firefox`. Expected: all PASS (the
      existing e2e is unchanged).
- [ ] **Step 4: Screenshots** with `npm run dev` (port 5292): the setup map with the legend in
      the host card (light and dark), and the list open with the sample EV rows, plus a hovered
      EV point's tooltip. Save them in the scratchpad directory, stop the server.
- [ ] **Step 5: Commit** `git commit -m "Demo, README and CLAUDE.md for framed and detail"`.

### After Task 5

Final whole-branch review, then ask the user before pushing and opening the PR. When it's open,
tell `data-dashboard-b7` and `monitor-map-2a`, and update the map-sdk bullet in data-dashboard
`TODO.md`.
