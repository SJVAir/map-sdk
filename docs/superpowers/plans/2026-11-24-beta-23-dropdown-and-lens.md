# `@sjvair/map-sdk` `0.1.0-beta.23` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A label press keeps a wide options dropdown open inside a focusable ancestor; child
option rows line up under the parent's icon; the lens stops flashing arriving and leaving
townships clear.

**Architecture:** A capture-phase press flag in `OptionsMenu.svelte`; padding rules in
`OptionRows.svelte`; in `shapes-lens.svelte.ts`, a host-answered `childrenLoaded` filter on the
hidden set and a split apply (hide on whole load, show per overlapping tile).

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (client and browser projects), MapLibre events
through `GlMapLike`.

**Spec:** `docs/superpowers/specs/2026-11-24-beta-23-dropdown-and-lens-design.md`

## Global Constraints

- Tabs, double quotes, no trailing commas, print width 100; `npm run format` before each commit.
- Svelte 5 runes only. Theme tokens only in component CSS.
- No new message keys; no removed props or exports; `@sjvair/sdk` peer range unchanged.
- Specs live in `tests/`, never `src/lib`. Browser specs that hover or click call `parkPointer()`
  in `afterEach`.
- Every new test must be seen to fail with its fix removed (undo the code, run, restore).
- While building, run only the spec files a task names. The full suite runs once, in Task 6.
- Run `npm run check` before each commit; `npm run test:bundle` before any commit touching
  `src/lib` (Task 6 runs it once for the branch if a task skipped it).
- Commits: no `Co-Authored-By`, `Claude-Session` or any AI attribution lines. Stage by path;
  never `git stash`.

## Review Focus

1. A press that starts inside the dropdown and is released outside it (drag off the label): the
   flag must still clear, so a later Tab-out closes. Task 1 test "a press released outside still
   lets Tab close it".
2. Keyboard Tab past the last row while the ancestor is focusable: must still close. Task 1.
3. A lens recentre back onto a block before its leaving tiles arrived (a parent pending show is in
   the new hidden set): it must stay hidden, never flash. Task 4.
4. A tile event with no `tileID` (the fake's `{}`, or a MapLibre event shape we don't expect):
   shows nothing early; backstops still apply. Task 4.
5. `childrenLoaded` turning true with no new children data (the host already had them): the hide
   must still apply (nothing reloads, so it applies at once). Task 3.

---

### Task 1: The dropdown stays open on a press inside it

**Files:**

- Modify: `src/lib/options/OptionsMenu.svelte` (`onfocusout`, about lines 50–61; the root `div`)
- Modify: `tests/fixtures/OptionsToolbarHost.svelte`
- Test: `tests/browser/options-toolbar.browser.test.ts` (new `describe`)

**Interfaces:**

- Produces: `OptionsToolbarHost` prop `focusable?: "-1" | "0"`: when set, the fixture wraps the
  "outside" div and the toolbar in `<main tabindex={focusable}>`.

- [ ] **Step 1: Add the fixture prop.** No ancestor when `focusable` is undefined (existing tests
      unchanged).

- [ ] **Step 2: Write the failing tests** in
      `describe("OptionsToolbar, wide, inside a focusable ancestor")`, each run for both
      `focusable` values (`describe.each(["-1", "0"])`). Groups: the file's `groups()` plus, for
      the radio case, a group `{ id: "mode", label: "Mode", rows: [{ kind: "radio", id: "mode",
      choices: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] }] }` (no
      `closesMenu`), with `mode: "a"` in values. Press = `page.getByText(<label>, { exact: true
      }).click()` on the label's text span.
  - `"a label press twice toggles twice and keeps a click-opened dropdown open"`: click trigger
    "Monitors"; press "Inactive" → `expanded("Monitors") === "true"`, `inactive` true; press again
    → still `"true"`, `inactive` false.
  - Same for a hover-opened dropdown (`trigger("Monitors").hover()`, then the two presses).
  - Same for the select-all row "Low-cost sensors" (its value flips as `applyGroup` does), the
    chevron row "EV Chargers" in "Layers", and the radio "Beta" then "Alpha" in "Mode".
  - `"Tab past the last row still closes"`: click-open "Monitors", focus the last checkbox,
    `userEvent.tab()` → `expanded("Monitors") === "false"`.
  - `"a press released outside still lets Tab close it"`: click-open "Monitors";
    `userEvent.hover` "Inactive" label, `page.mouse`-style down via
    `userEvent.pointer([{ keys: "[MouseLeft>]", target: <label> }, { pointerName: "mouse",
    target: <outside div> }, { keys: "[/MouseLeft]" }])` (use what Vitest's `userEvent` offers
    for a press held across a move); then focus the last checkbox and `userEvent.tab()` →
    closed.

- [ ] **Step 3: Run to see the label-press tests fail and the Tab test pass**
      Run: `npx vitest run --project browser tests/browser/options-toolbar.browser.test.ts -t "focusable ancestor"`
      Expected: the "press twice" tests FAIL (`expanded` is `"false"` after a press).

- [ ] **Step 4: Implement the press flag in `OptionsMenu.svelte`.** A non-reactive
      `let pressing = false`. On the root: a capture `onpointerdowncapture` sets it. A
      `document`-level `pointerup` and `pointercancel` listener (added in an `$effect`, removed on
      teardown) clears it in a `setTimeout(…, 0)`. In `onfocusout`, when `next` is outside `root`
      and `pressing` is true, return without closing. Update the comment to say why (a press on a
      part that takes no focus moves focus to the nearest focusable ancestor).

- [ ] **Step 5: Run the new tests and the whole file**
      Run: `npx vitest run --project browser tests/browser/options-toolbar.browser.test.ts`
      Expected: PASS.

- [ ] **Step 6: Undo Step 4's `onfocusout` check, rerun, confirm the new tests fail; restore.**

- [ ] **Step 7: `npm run check`, then commit** `src/lib/options/OptionsMenu.svelte`,
      `tests/fixtures/OptionsToolbarHost.svelte`,
      `tests/browser/options-toolbar.browser.test.ts`: "Options: a press inside a dropdown keeps
      it open inside a focusable ancestor".

### Task 2: Child rows line up under the parent's icon

**Files:**

- Modify: `src/lib/options/OptionRows.svelte` (children containers, lines ~62–64 and ~91–95;
  `<style>`)
- Test: `tests/browser/options-toolbar-layout.browser.test.ts` (new `describe`)

**Interfaces:** none across tasks.

- [ ] **Step 1: Write the failing tests** `describe("child rows line up with their parent")`. Group
      "Monitors" with rows: a `group` row with an `icon` (any `OptionIcon`, e.g. the markup string
      a `circle(...)` marker export returns) and two checkbox children; a `checkbox` row with no
      icon and a child that itself has a child (two nesting levels). Values open all of them.
      Helpers measure `getBoundingClientRect()`.
  - `"a child's checkbox is centred under the parent's icon"`: |centreX(child input) −
    centreX(parent's icon element)| ≤ 0.5px, wide (click-open) and narrow (the layout file's
    narrow setup, panel open).
  - `"under a parent with no icon, a child's checkbox starts at the parent's label"`:
    |left(child input) − left(parent `.mapsdk-option-label`)| ≤ 0.5px; same for the grandchild
    against the child's label.
  - `"the guide line stays under the parent's checkbox"`: the children container's left border
    x (its `getBoundingClientRect().left`) is within 1px of centreX(parent input), at both levels.

- [ ] **Step 2: Run to see the first two fail**
      Run: `npx vitest run --project browser tests/browser/options-toolbar-layout.browser.test.ts -t "line up"`
      Expected: FAIL (about 5px and 4px off).

- [ ] **Step 3: Implement in `OptionRows.svelte`.** Values from the spec: under an icon the child
      row's left padding makes its checkbox centre equal the icon centre (`calc(1.125rem - 1px)`
      at the first level); with no icon, its checkbox left equals the label left
      (`calc(1rem - 1px)`). Each nested children container keeps its line under its own parent's
      checkbox centre. Mark the container (e.g. `data-under-icon` or a class) from `row.icon`; a
      CSS custom property for the row's left padding, set per container, is the expected shape.

- [ ] **Step 4: Run the layout file and the toolbar file**
      Run: `npx vitest run --project browser tests/browser/options-toolbar-layout.browser.test.ts tests/browser/options-toolbar.browser.test.ts`
      Expected: PASS.

- [ ] **Step 5: Undo Step 3, confirm the new tests fail; restore.**

- [ ] **Step 6: `npm run check`, then commit** both files: "Options: child rows' checkboxes line
      up under the parent's icon".

### Task 3: `childrenLoaded` keeps an incomplete parent shown

**Files:**

- Modify: `src/lib/plugins/shapes-lens.svelte.ts` (`ShapesLensOptions`; the hidden-set effect,
  lines ~213–223)
- Test: `tests/client/plugins/shapes-lens.test.ts` (`setUp` gains `childrenLoaded`; new tests in
  the "hides its parents once the children have loaded" `describe`)

**Interfaces:**

- Produces: `ShapesLensOptions<C>.childrenLoaded?(parentKey: string): boolean`, JSDoc: "Whether
  the source holds every child of this parent. A parent hides under its children only once it
  says so (default: always). Read reactively."

- [ ] **Step 1: Write the failing tests.** Drive `childrenLoaded` from a `$state`-backed
      `SvelteSet` of loaded parent keys in the test.
  - `"a parent its host hasn't fully loaded stays shown under its drawn children"`: pin (2,2)
    with the set holding only (2,2)'s block minus `parentKey(1,1)` → after `finishData`,
    `hiddenParents` is the block without `parentKey(1,1)`.
  - `"it hides once childrenLoaded says so, after the children's next load"`: from there, add
    `parentKey(1,1)` and change the children source's features (a new array, same contents);
    `holdData` on → still not hidden; `finishData` → hidden.
  - `"childrenLoaded turning true with no new children data hides at once"`: add the key without
    touching the source → hidden after `settle()` (Review Focus 5).
  - `"omitted, every parent with a drawn child hides as before"`: covered by the existing tests;
    add none.

- [ ] **Step 2: Run to see them fail**
      Run: `npx vitest run --project client tests/client/plugins/shapes-lens.test.ts`
      Expected: the new tests FAIL (the unloaded parent is hidden).

- [ ] **Step 3: Implement.** In the hidden-set effect, keep a key only if
      `options.childrenLoaded?.(key) ?? true`. If that leaves the effect with nothing for the
      children source to reload (the data didn't change), it must still apply: check that the
      current `applyIfLoaded` path does (the fake's source is loaded), and fix it if not.

- [ ] **Step 4: Run the file** (same command). Expected: PASS.

- [ ] **Step 5: Undo Step 3, confirm the new tests fail; restore.**

- [ ] **Step 6: `npm run check`, `npm run test:bundle`, commit** both files: "shapesLens:
      childrenLoaded, so a parent hides only once its host holds all its children".

### Task 4: A leaving parent shows at its first overlapping tile

**Files:**

- Create: `src/lib/plugins/tile-bounds.ts`
- Modify: `src/lib/plugins/shapes-lens.svelte.ts` (the apply logic, lines ~176–223)
- Modify: `tests/fixtures/fake-gl.ts` only if a helper to emit a tile event with a `tileID` helps
- Test: `tests/unit/plugins/tile-bounds.test.ts`, `tests/client/plugins/shapes-lens.test.ts`

**Interfaces:**

- Consumes: `geometryBbox` from `src/lib/core/shape-view.ts`; `hooks.geometryOf(key)`.
- Produces: `tileBounds(tile: unknown): [west: number, south: number, east: number, north:
  number] | null` in `tile-bounds.ts`: from `tile.tileID.canonical` `{ z, x, y }` (Web Mercator
  XYZ), null for any other shape.

- [ ] **Step 1: Write `tile-bounds.test.ts`:** `{ tileID: { canonical: { z: 0, x: 0, y: 0 } } }`
      → `[-180, -85.0511…, 180, 85.0511…]` (`toBeCloseTo`, 4); z 1, x 1, y 0 → `[0, 0, 180,
      85.0511…]`; `{}`, `null`, `{ tileID: {} }` → `null`.

- [ ] **Step 2: Run it to fail, implement `tileBounds`, run it to pass**
      Run: `npx vitest run --project unit tests/unit/plugins/tile-bounds.test.ts`

- [ ] **Step 3: Write the failing lens tests** in the "hides its parents…" `describe` (use the
      file's `held()`; the grid is 1° squares from [0, 0], so pick a `z` 8 tile that overlaps
      only the leaving column's parents, computing x/y in the test from lng/lat).
  - `"a leaving parent shows at the first tile of the new children that overlaps it"`: pin (2,3)
    from (2,2) → emit `sourcedata` `{ sourceId, isSourceLoaded: false, tile: <tile over
    parentKey(…,1) parents> }` → the column-1 parents are no longer hidden; the arriving
    column-4 parents are not hidden yet; `finishData` → exactly (2,3)'s block hidden.
  - `"a tile that overlaps no leaving parent shows none"`: a tile far from the grid → hidden set
    unchanged.
  - `"a parent pending show that the next recentre hides again stays hidden"` (Review Focus 3):
    pin (2,3), then pin back (2,2) before any tile, then a tile over column 1 → column 1 stays
    hidden.
  - `"a tile event with no tileID shows nothing early"` (Review Focus 4): existing test "a second
    recentre before the load applies only the latest" already emits `tile: {}`; keep it passing.

- [ ] **Step 4: Run to see them fail**
      Run: `npx vitest run --project client tests/client/plugins/shapes-lens.test.ts`

- [ ] **Step 5: Implement in `shapes-lens.svelte.ts`.** Track the applied set (what
      `setHidden` last got) next to `pending`. On a child-source `sourcedata` event carrying a
      tile with `tileBounds` non-null (loaded or not): for each key in applied but not in
      `pending`, if its `geometryBbox(hooks.geometryOf(key))` intersects the tile bounds, drop it
      from applied; call `setHidden(applied)` if anything changed. The whole-load / `error` /
      `idle` paths still apply `pending` whole (hides included). A new pending set replaces the
      old (a key back in `pending` is no longer a candidate to show). Keep the comments' "why".

- [ ] **Step 6: Run the client file** (same command). Expected: PASS.

- [ ] **Step 7: Undo Step 5, confirm the new lens tests fail; restore.**

- [ ] **Step 8: `npm run check`, `npm run test:bundle`, commit** the four files: "shapesLens: a
      leaving parent shows at its first reloaded tile".

### Task 5: Docs and version

**Files:**

- Modify: `package.json` (`version` → `0.1.0-beta.23`; `package-lock.json` via
  `npm version 0.1.0-beta.23 --no-git-tag-version`)
- Modify: `README.md` (the `shapesLens` section ~line 347: `childrenLoaded`, with a short
  host-shaped example: a set of loaded blocks answering it; "Changes": a `0.1.0-beta.23` entry
  with the four changes, each stated from map-sdk's side)
- Modify: `tests/unit/readme-examples.test.ts` (the `shapesLens` example passes `childrenLoaded`)
- Modify: `CLAUDE.md` (Plugins → `shapesLens` line: `childrenLoaded`, hide on whole load / show
  per overlapping tile; Options → `OptionsMenu` press flag; `OptionRows` alignment)

- [ ] **Step 1: Make the edits.** No to-do lists for other projects.
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/readme-examples.test.ts`, `npm run check`,
      `npx prettier --check README.md CLAUDE.md`; scan added lines over 100 columns
      (`git diff -U0 | grep '^+' | awk 'length > 101'`).
- [ ] **Step 3: Commit** the files: "0.1.0-beta.23: the dropdown label press, child-row alignment,
      two lens flashes".

### Task 6: Whole-branch verification

- [ ] **Step 1:** `npm run lint && npm run check && npm test && npm run test:bundle &&
      npm run test:licenses`. Expected: all pass.
- [ ] **Step 2:** `npx playwright test --project chromium --project firefox`. Expected: pass.
- [ ] **Step 3: Flake check for the new hover/press tests:**
      `for i in 1 2 3 4 5; do taskset -c 0,1 npx vitest run --project browser tests/browser/options-toolbar.browser.test.ts tests/browser/options-toolbar-layout.browser.test.ts || break; done`.
      Expected: 5 passes.
- [ ] **Step 4: Dropdown in a real page.** On the demo (`npx vite --port 5288 --strictPort`), with
      Playwright give the map's ancestor `tabindex="-1"` at runtime, open Monitors by click, press
      a child label twice: stays open, toggles twice. Repeat on `main` (expected to close) to show
      the check reproduces the bug. Stop vite with `kill $(lsof -t -i :5288)`.
- [ ] **Step 5: Lens flashes.** Make a data-dashboard worktree
      (`git -C ../data-dashboard worktree add --detach .worktrees/lens-check-b23 origin/step-6`),
      `npm ci`, copy this branch's `npm pack` output into its `node_modules/@sjvair/map-sdk`, and
      patch (untracked, never committed) its `UseLayers.svelte` lens to pass
      `childrenLoaded: (key) => <township in a loaded block>` from `use-block.svelte.ts`'s
      `blocks`. Run `.superpowers/lens-check/run.sh <worktree> b23 both`; compare
      `summary-b23-*.txt` with `summary-b22-*`: `beforeLoad`/`notInData` (arriving) and
      `leavingEarly` (leaving) should drop to 0, `tint` and `regress` stay 0 or near. Report both
      results to the user and to the coordinator.
- [ ] **Step 6:** Fresh whole-branch review on the most capable model (superpowers:requesting-code-review),
      then fix its findings, minors included, each with targeted tests.
