# List button position and focus reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `MapView`'s `featureList` prop also takes `{ position, reveal }`, placing the List button
and panel in any corner (stacked clear of the controls there) and optionally showing the button
only while it or its open panel has keyboard focus.

**Architecture:** A small pure module (`src/lib/view/list-placement.ts`) normalizes the prop and
describes each corner. `MapView` measures the controls in the button's corner and at the far end of
its side (the engine's `.maplibregl-ctrl-<corner>` elements, and map-sdk's `.mapsdk-zoom`) with a
`ResizeObserver`, and passes the results to the panel as CSS custom properties. The reveal is CSS
only (`:focus-within` plus an "open" state). `setListInset` gains a side so the focus pan works for
right-hand panels.

**Tech Stack:** Svelte 5 runes, TypeScript, scoped CSS, Vitest (unit, client, browser projects),
Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-list-button-options-design.md` (approved 2026-11-05).
Read it first.

## Global Constraints

- `featureList`, `featureList={true}` and `featureList={false}` behave exactly as today; the
  default (`top-left`, `always`) keeps today's DOM, CSS, Tab order and inset behavior, except
  that the open panel stops short of MapTiler's logo bottom-left when it shows.
- Theme tokens only, no hardcoded colors; every UI string is a `mapsdk_*` key in `en.json` (this
  change needs no new strings).
- Hidden means the skip-link pattern (as `.mapsdk-sr`: `position: absolute; width: 1px; height:
  1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap`). Never `display: none`,
  `visibility: hidden`, `aria-hidden`, or `opacity: 0` alone.
- No reveal animation. Respect `prefers-reduced-motion` everywhere else as today.
- Tabs, double quotes, no trailing commas, 100 columns; `npm run format` before each commit.
- Commits carry no AI attribution. Never push, open a PR, merge, tag or publish without the user's
  explicit yes (ask when the branch is ready).
- Run `npm run test:bundle` before committing any change under `src/lib`.

## Review Focus

1. **The engine's controls aren't there yet:** the corner is measured before the GL map exists, or
   after `active` toggles off and on (the GL container is rebuilt). The button must fall back to
   the 0.75rem inset, then move under the controls once they appear. Test in Task 2 (`active`
   toggle).
2. **The credits change size:** the attribution switches between compact and full as the map
   resizes, so the far-end limit must follow it. Test in Task 2 (resize the map, panel bottom
   stays above the credits' top).
3. **Options changed after mount:** switching `position` or `reveal` on a mounted map re-measures
   and re-places it, with no GL map rebuild. Test in Task 2 (`rerender`).
4. **The panel is open and focus goes to the map canvas** (a click on the map with
   `reveal: "focus"`): the button and panel stay visible. Test in Task 3.
5. **A short map:** with the controls above and the credits below, the gap left for the panel is
   small. The panel shrinks (it scrolls inside, as today) and never goes past the map's edges or
   below zero height. Test in Task 2 (240px-tall map, top-right, engine controls).

---

### Task 1: Option type, normalization, and a side-aware list inset

**Files:**

- Create: `src/lib/view/list-placement.ts`
- Modify: `src/lib/core/create-map.svelte.ts` (the `setListInset` declaration near line 197, the
  `#listInset` field near 270, `focusFeature` near 438, the method near 514)
- Modify: `src/lib/index.ts` (export the type next to `MapView`)
- Test: `tests/unit/view/list-placement.test.ts` (create), `tests/client/core/create-map.test.ts`

**Interfaces:**

- Produces:
  - `export type ListPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";`
  - `export interface FeatureListOptions { position?: ListPosition; reveal?: "always" | "focus"; }`
    (doc comments as in the spec).
  - `export function resolveFeatureList(value: boolean | FeatureListOptions | undefined): { position: ListPosition; reveal: "always" | "focus" } | null`
    (`undefined` and `true` → `{ position: "top-left", reveal: "always" }`; `false` → `null`;
    missing keys default the same way).
  - `export function cornerSides(position: ListPosition): { vertical: "top" | "bottom"; horizontal: "left" | "right"; far: ListPosition }`
    (`far` is the other corner on the same side: `top-right` → `bottom-right`, `bottom-left` →
    `top-left`, and so on).
  - `MapContext.setListInset(width: number, side?: "left" | "right"): void` (`side` defaults to
    `"left"`, so the existing call and test keep working). `focusFeature` offsets by
    `[width / 2, 0]` for `"left"` and `[-width / 2, 0]` for `"right"`.
  - `FeatureListOptions` and `ListPosition` exported from `src/lib/index.ts`.

- [ ] **Step 1: Write the failing unit tests** in `tests/unit/view/list-placement.test.ts`:
      `resolveFeatureList(undefined)` and `(true)` and `({})` equal
      `{ position: "top-left", reveal: "always" }`; `(false)` is `null`;
      `({ position: "top-right", reveal: "focus" })` round-trips; `({ reveal: "focus" })` is
      `{ position: "top-left", reveal: "focus" }`. `cornerSides` for all four corners, e.g.
      `cornerSides("bottom-right")` equals
      `{ vertical: "bottom", horizontal: "right", far: "top-right" }`.
- [ ] **Step 2: Add the failing client test** to the existing focus-offset test in
      `tests/client/core/create-map.test.ts`: after `map.setListInset(240, "right")`,
      `map.focusFeature("monitor:5")` is last called with `objectContaining({ offset: [-120, 0] })`.
- [ ] **Step 3: Run** `npx vitest run --project unit tests/unit/view/list-placement.test.ts` and
      `npx vitest run --project client tests/client/core/create-map.test.ts`. Expected: FAIL
      (module missing; offset `[120, 0]`).
- [ ] **Step 4: Implement** the module and the `setListInset` change (store the side next to the
      width; update the doc comment: "how many pixels at the map's left or right edge the open
      panel covers"). Export the types from `index.ts`.
- [ ] **Step 5: Run** both commands again, then `npm run check`. Expected: PASS, 0 errors.
- [ ] **Step 6: Commit** `git commit -m "Feature list options: type, defaults, and a side for the list inset"`.

### Task 2: Corner placement, stacking against controls, and the far-end limit

**Files:**

- Modify: `src/lib/view/MapView.svelte`
- Modify: `src/lib/ui/SelectionBar.svelte` (one optional prop)
- Test: `tests/browser/list-position.browser.test.ts` (create; copy the offline setup, `newMap`,
  `trackAttach`, `whenLoaded` and warning filter from `tests/browser/view-controls.browser.test.ts`,
  whose inline style has an attribution so the credits render)

**Interfaces:**

- Consumes: `resolveFeatureList`, `cornerSides`, `FeatureListOptions` (Task 1);
  `setListInset(width, side)` (Task 1).
- Produces:
  - `MapView` prop `featureList?: boolean | FeatureListOptions` (default `true`).
  - The panel wrapper `.mapsdk-list-panel` carries `data-position={position}` and
    `data-reveal={reveal}` (Task 3 and the e2e test select on these).
  - `SelectionBar` prop `clearRight?: boolean` (default `false`): when true the bar's right inset
    leaves room for a top-right List button the way `left: 5rem` does for the top-left one (use
    `right: 5rem`).

Placement rules (from the spec):

- The panel wrapper sits in its corner (`top`/`bottom` and `left`/`right`). In a bottom corner
  the button is below its panel (`flex-direction: column-reverse`); in a right corner both are
  right-aligned (`align-items: flex-end`).
- **Near extent:** how far the controls in the button's corner reach in from the map's top (or
  bottom) edge, in px. 0 when none. Sources: the GL container's `.maplibregl-ctrl-<position>`
  element when it has a non-zero height, and for `top-right` with `controls="mapsdk"` the
  `.mapsdk-zoom` element. For top corners, it's `rect.bottom - root.top`; for bottom corners,
  `root.bottom - rect.top`; take the max over the sources.
- **Far extent:** the same measurement for `cornerSides(position).far`.
- The wrapper's vertical inset is `0.75rem` when the near extent is 0, else
  `calc(<near>px + 0.5rem)`. Its `max-height` is `calc(100% - <near inset> - <far inset>)`, where
  the far inset is the same rule with the far extent. Pass both as custom properties
  (`--mapsdk-list-near`, `--mapsdk-list-far`) with the 0.75rem fallback in CSS.
- Measure with one `ResizeObserver` on the root and the source elements, set up in an `$effect`
  that re-runs when `projector`, `controls` or the resolved position change (the GL container's
  children are rebuilt when `active` toggles). Disconnect it in the effect's cleanup.
- The inset effect calls `map.setListInset(box.right - root.left, "left")` for left corners and
  `map.setListInset(root.right - box.left, "right")` for right corners.
- `<SelectionBar {map} clearRight={position === "top-right" && controls === "none"} />`. With
  `"mapsdk"` or `"engine"` controls, the button stacks below the top-right controls, so it's
  already below the bar's row.
- Tab order stays as today (the panel after the GL container in the DOM). Moving the button into
  the engine's control container is too fragile across `active` rebuilds, so it isn't done (the
  spec's "aim, not at the cost of fragile" call). Say so in the PR.

- [ ] **Step 1: Write the failing browser tests** in `tests/browser/list-position.browser.test.ts`
      (use a `.wide-map` 600×400 and a `.short-map` 600×240 class):
  - `it.each` over the 4 positions × `["mapsdk", "engine", "none"]`: the List button's rect lies
    inside the map root's rect, on the expected sides (within 0.75rem + 1px of the two edges, or
    further only when controls are in that corner), and does not intersect the rect of any
    `.maplibregl-ctrl-<position>` child, `.mapsdk-zoom`, or `.maplibregl-ctrl-attrib`.
  - "stacks below the engine's controls top-right": with `controls: "engine"` and
    `position: "top-right"`, `button.top >= ctrlTopRight.bottom` and the gap is ≤ 8px + 1px.
  - "stacks below map-sdk's zoom buttons": the same with `controls: "mapsdk"` and
    `.mapsdk-zoom`.
  - "opens toward the middle and stops short of the far end": open the list for each corner;
    for top corners `listbox.top > button.bottom`; for bottom corners `listbox.bottom <
    button.top`; for `top-right` with `engine`, the open panel's bottom is `<=` the
    `.maplibregl-ctrl-bottom-right` top; for `bottom-right` with `engine` the panel's top is
    `>=` the `.maplibregl-ctrl-top-right` bottom.
  - "follows the credits' size": `top-right`, `engine`, panel open; change the map's width so
    the attribution switches compact ↔ full (600px → 320px), then `vi.waitFor` the panel bottom
    `<=` the bottom-right corner's top.
  - "fits a short map" (Review Focus 5): `.short-map`, `top-right`, `engine`, panel open: the
    panel's rect is inside the map and its height is > 0.
  - "re-places after `active` toggles" (Review Focus 1): `top-right`, `engine`; `rerender({
    active: false })` then `{ active: true }`; `vi.waitFor` the button below the new
    `.maplibregl-ctrl-top-right`.
  - "moves when the options change" (Review Focus 3): render with `featureList: true`, then
    `rerender({ featureList: { position: "bottom-left" } })`; the button moves to the
    bottom-left and `map.attach` was called once.
  - "pans clear of a right-hand panel": like the existing "pans a focused feature clear of the
    open list panel" test in `map-view.browser.test.ts`, with `position: "top-right"`, a feature
    east of the center, and `panelLeft = listbox.left - map.left`; after `focusFeature`, the
    feature's projected `x` is `< panelLeft` and `> 0`.
  - "the selection bar makes room top-right": `controls: "none"`, `position: "top-right"`, a
    selection set, and the bar's rect doesn't intersect the button's.
- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/list-position.browser.test.ts`.
      Expected: FAIL (the object form isn't accepted yet).
- [ ] **Step 3: Implement** the rules above in `MapView.svelte` and the `clearRight` prop in
      `SelectionBar.svelte`. Update the `featureList` prop's doc comment to describe both forms.
- [ ] **Step 4: Run** the new file, then the whole browser project (`npm run test:browser`) so the
      existing `MapView list button` tests prove the default is unchanged. Expected: all PASS.
- [ ] **Step 5: Run** `npm run check && npm run lint && npm run test:bundle`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Feature list position: any corner, stacked clear of the controls"`.

### Task 3: Focus reveal

**Files:**

- Modify: `src/lib/view/MapView.svelte` (styles keyed on `data-reveal="focus"` and an open state)
- Test: `tests/browser/list-position.browser.test.ts` (a `describe("reveal: focus")` block)

**Interfaces:**

- Consumes: the wrapper's `data-reveal` and `listOpen` from Task 2.
- Produces: nothing new for other tasks.

Rule: with `data-reveal="focus"`, while the list is closed and the wrapper doesn't match
`:focus-within`, the button gets the hidden pattern from Global Constraints. Otherwise it's the
normal button in its normal spot. Mark the open state on the wrapper (for example
`data-open={listOpen}`), so it stays shown while open whatever has focus.

- [ ] **Step 1: Write the failing tests** (`controls: "engine"`,
      `featureList: { position: "top-right", reveal: "focus" }`):
  - "is hidden but named and tabbable": the button's rect is ≤ 1×1 px; computed `display` isn't
    `none`, `visibility` is `visible`; it has no `aria-hidden`; and
    `page.getByRole("button", { name: "List of features on the map" })` finds it.
  - "appears in place on keyboard focus": `userEvent.tab()` from the canvas until the button is
    `document.activeElement` (at most 10 presses); then its rect is larger than 1×1, below the
    `.maplibregl-ctrl-top-right` bottom, and its computed `outline-style` (or box-shadow, as the
    existing focus-ring test in `focus-motion.browser.test.ts` checks) shows the focus ring.
  - "stays visible while the panel is open and focus is on the map" (Review Focus 4): Enter opens
    it; focus the canvas; the button and the listbox are both larger than 1×1.
  - "hides again after closing and leaving": Escape (focus returns to the button, still visible),
    then `userEvent.tab()` away; the button is ≤ 1×1 again.
  - "always stays visible by default": with `featureList: true`, the button is larger than 1×1
    without focus.
  - "doesn't animate": the button's computed `transition-property` doesn't include `clip-path`,
    `width`, `height` or `opacity`.
- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/list-position.browser.test.ts`.
      Expected: the new block FAILs.
- [ ] **Step 3: Implement** the reveal CSS in `MapView.svelte`.
- [ ] **Step 4: Run** the file and `npm run test:browser`. Expected: PASS.
- [ ] **Step 5: Run** `npm run check && npm run lint && npm run test:bundle`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "Feature list reveal: shown only on keyboard focus or while open"`.

### Task 4: Demo switches, keyboard e2e, README, and screenshots

**Files:**

- Modify: `demo/App.svelte` (the "Monitor-map setup map" section, near line 366)
- Modify: `e2e/demo.spec.ts`
- Modify: `README.md` (the `MapView` paragraph near line 115), `tests/unit/readme-examples.test.ts`
- Modify: `CLAUDE.md` (the View bullet: mention `featureList` options)

**Interfaces:**

- Consumes: `FeatureListOptions` (Task 1), `data-position` / `data-reveal` (Task 2).

Demo: in the setup map's existing controls fieldset, a `<select>` labeled "List button corner"
(the four positions, default `top-left`) and a checkbox labeled "Show the List button only on
keyboard focus" (default off). Pass `featureList={{ position, reveal: focusOnly ? "focus" :
"always" }}`. The defaults keep the demo's look.

- [ ] **Step 1: Write the failing e2e test** in `e2e/demo.spec.ts`, "keyboard only: monitor-map's
      focus-revealed List button top right": reload; select `top-right` and check the checkbox on
      the setup map; `tabUntil` (reuse the existing helper, moved to module scope) the setup map's
      canvas, then the button named "List of features on the map" (limit 15). Assert its bounding
      box is wider than 1px and its top is ≥ the `.maplibregl-ctrl-top-right` bottom. Before that
      Tab, assert its bounding box is ≤ 1px. Enter opens the listbox "Features on the map"; Tab
      into it; Escape closes it and focus is back on the button; Tab moves on and the button is
      ≤ 1px again. Use the existing `Alt+Tab` for WebKit.
- [ ] **Step 2: Run** `npx playwright test --project chromium --project firefox -g "focus-revealed"`.
      Expected: FAIL (no demo controls).
- [ ] **Step 3: Add the demo controls.**
- [ ] **Step 4: Run** `npx playwright test --project chromium --project firefox`. Expected: all
      PASS, including the unchanged "keyboard only: Tab reaches the map, the List button..." test.
- [ ] **Step 5: README:** describe `featureList={{ position, reveal }}` in the `MapView`
      paragraph: the corners, stacking under or over the controls in that corner, the panel
      stopping short of the far end's controls and credits, `reveal: "focus"` (skip-link
      pattern, stays shown while open), and "the open panel is `z-index: 2` inside the map, so a
      host's own menus can sit above it". Add a `featureList` object example to
      `tests/unit/readme-examples.test.ts` alongside the existing `MapView` example, typed with
      `FeatureListOptions`. Update the `CLAUDE.md` View bullet.
- [ ] **Step 6: Run** `npm run check && npm run lint && npm test && npm run test:bundle`. Expected:
      PASS.
- [ ] **Step 7: Screenshots for the user:** with `npm run dev` (the local stack on :8000 and the
      `.env` key), capture the setup map at each corner with the list closed and open, and the
      focus reveal (before Tab, after Tab, open) into the scratchpad directory. Stop the dev
      server afterwards. Show them to the user before asking about the PR.
- [ ] **Step 8: Commit** `git commit -m "Demo, e2e and README for the List button options"`.

### After Task 4

Ask the user before pushing and opening the PR (no merge without their yes). When the PR is open,
tell `data-dashboard-b7` and `monitor-map-2a`, and update the map-sdk bullet in data-dashboard
`TODO.md` "Release 1, step 5" from the docs worktree. When it's merged, tell the coordinator; the
first publish is the user's call through the coordinator.
