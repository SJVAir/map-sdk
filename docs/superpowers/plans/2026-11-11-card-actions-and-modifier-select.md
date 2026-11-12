# Card buttons, modifier-select, and refusing a pick (part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give hosts three things:
- a slot on the pinned card for their own buttons (the dashboard's Select and Remove);
- a per-plugin mode where a plain click only pins the card and Shift/Cmd/Ctrl-click (or the list's additive key) toggles selection;
- a hook that refuses a pick before it shows, with a short announced message.

It ships as `@sjvair/map-sdk` `0.1.0-beta.9`.

**Architecture:**
- **The mode and the refusal hook** are two new `PluginOptions`, `pickWith` and `canSelect`. `MapContext.#applyPick`, the one place a user's pick changes a selection, applies both.
- **The router reports modifiers and touch separately,** so `"modifier"` mode can ignore touch, which is "additive" today.
- **Host buttons** come from `MapView`'s `card` prop, which widens to `boolean | CardOptions`, with an `actions` snippet. Their Select/Remove go through a new `MapContext.togglePick`, so the same rules and the same refusal apply.
- **A refusal** sets a reactive `MapContext.notice`, which a new `PickNotice` component shows and announces.

**Tech Stack:** Svelte 5 runes, TypeScript, MapTiler SDK 4.2 (MapLibre), Vitest (unit, client, browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-options-toolbar-and-widget-needs-design.md`, section "2. Host buttons, selection mode, and refusing a pick". Part 1 (the pinned card, `0.1.0-beta.8`) is merged; this builds on its `MapContext.pinned`, `unpin()`, and `MapTooltip`'s card.

## Global Constraints

- **Opt-in.** With `pickWith` unset (default `"click"`), `canSelect` unset, and `card` a boolean, every map behaves exactly as in `0.1.0-beta.8`. monitor-map sets none of them.
- **`card: true` keeps working** (no break). `card` widens to `boolean | CardOptions`.
- **A refused pick changes nothing:** no selection change, no `onselectionchange`, no flash. `featureclick` still fires, and the card still pins.
- **`canSelect` isn't consulted for `setSelection`** (host → map) **or for the selection bar's Clear.**
- **Every map-sdk UI string is a `mapsdk_*` key.** The refusal message is the host's own text. Theme tokens only. Under reduced motion, nothing animates.
- **Nothing module-global.** Code style: tabs, double quotes, no trailing commas, width 100, runes only.
- **Before each commit under `src/lib`:** `npm run lint && npm run check && npm test && npm run test:bundle`.
- **No Claude or AI attribution.** Push and PR, merge, and the release each need the user's yes. (The user approved pushing a PR for this part, 2026-11-11, by asking for part 2 to start. The merge and the release are separate yeses.)

## Review Focus

1. **A touch tap in `"modifier"` + `"multiple"` mode:** it pins only and never adds, although the router still reports touch. Pinned in Task 3.
2. **A refusal, then an allowed pick on the same plugin:** the notice clears on the next pick and the allowed pick applies. Pinned in Task 3 (state) and Task 6 (the notice).
3. **The card's Select on a feature whose plugin is in `"modifier"` mode with a cap reached:** it goes through `canSelect` like a Shift-click, shows the notice, and leaves the card open. Pinned in Task 5.
4. **`canSelect` throws:** the pick is refused quietly. The error is logged (`"map-sdk: canSelect failed"`), the selection is unchanged, and no notice shows. Pinned in Task 3.
5. **Two maps:** one map's notice never shows on the other. Pinned in Task 6.

---

### Task 0: Branch

- [ ] `git fetch origin && git switch -c feat/card-actions origin/main`. Commit this plan: `git add docs/superpowers/plans/2026-11-11-card-actions-and-modifier-select.md && git commit -m "Plan: card buttons, modifier-select, refusing a pick"`

### Task 1: The toggle rule

**Files:**
- Modify: `src/lib/data/selection.ts`
- Test: `tests/unit/data/selection.test.ts`

**Interfaces:**
- Produces: `toggleInSelection(current: SpatialSelection | null, ref: FeatureRef, mode: SelectionMode): SpatialSelection | null`. It's the modifier-click rule:
  - `"none"`, or a ref with no selection kind: `current` unchanged.
  - `"single"`: `ref` is the selection, or `null` when it already is.
  - `"multiple"`: toggles `ref` in `current`. A different kind starts a new selection `[id]`, and removing the last id gives `null`.

- [ ] **Step 1: Write the failing tests** (`describe("toggleInSelection")`):
  - `"none" mode`: the input is returned unchanged (`toBe(current)`).
  - A `feature` ref leaves the selection unchanged.
  - `"single"`, empty: `{ kind: "monitors", ids: ["a"] }`.
  - `"single"` with `["a"]`, ref `a`: `null`. With `["a"]`, ref `b`: `["b"]`.
  - `"multiple"`: `["a"]` + `b` gives `["a","b"]`; `["a","b"]` − `a` gives `["b"]`; `["a"]` − `a` gives `null`.
  - `"multiple"`, a region ref on a monitors selection: `{ kind: "regions", ids: [...] }` holding only that region.
- [ ] **Step 2:** Run `npx vitest run --project unit tests/unit/data/selection.test.ts`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement it** next to `applyPick`, reusing `selectionKind` and `selectionId`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "selection: toggleInSelection, the modifier-click rule"`

### Task 2: Clicks report modifiers and touch

**Files:**
- Modify: `src/lib/core/plugin.ts` (`ClickEvent`, internal), `src/lib/core/interactions.svelte.ts` (`#onClick`)
- Test: `tests/client/core/interactions.test.ts`

**Interfaces:**
- Produces: `ClickEvent` gains `modifier: boolean` (Shift, Cmd, or Ctrl) and `touch: boolean` (`pointerType === "touch"`, with the recorded pointerdown fallback). `additive` stays as it is (`modifier || touch`), so nothing that reads it changes.

- [ ] **Step 1: Write the failing tests** (`describe("click modifiers")`, using `router.onPick` with the `routerSetUp` from `describe("misses")`):
  - A plain click gives `{ modifier: false, touch: false, additive: false }`.
  - A Shift click gives `{ modifier: true, touch: false, additive: true }`.
  - A touch click (`pointerType: "touch"`) gives `{ modifier: false, touch: true, additive: true }`.
- [ ] **Step 2:** Run `npx vitest run --project client tests/client/core/interactions.test.ts`. Expected: the three FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "Clicks report modifier keys and touch separately"`

### Task 3: `pickWith`, `canSelect`, `togglePick`, and `notice` in `MapContext`

**Files:**
- Modify: `src/lib/core/create-map.svelte.ts`
- Test: `tests/client/core/interactions.test.ts` (`describe("modifier mode and refusals")`)

**Interfaces:**
- Consumes: `toggleInSelection` (Task 1), `ClickEvent.modifier` and `.touch` (Task 2).
- Produces, on `PluginOptions`:
  - `pickWith?: "click" | "modifier"`. Default `"click"`, which is today's rules.
  - `canSelect?(next: SpatialSelection | null, ref: FeatureRef): true | string`. Called before a user's pick changes the selection. `true` lets it through; a string refuses it and is the message to show.
- Produces, on `MapContext`:
  - `getPickWith(pluginId: string): "click" | "modifier"`: reactive, `"click"` for an unknown plugin.
  - `togglePick(pluginId: string, ref: FeatureRef): void`: a user's toggle (the card's Select/Remove). It uses `toggleInSelection`, then `canSelect`, then `onselectionchange`, as a modifier-click does, in either `pickWith` mode.
  - `readonly notice: { message: string; id: number } | null`: reactive. The latest refusal. `id` increases with each one, so the same text twice re-announces. Cleared by the next pick that changes or keeps a selection, by `clearNotice()`, and on `detach` and `destroy`.
  - `clearNotice(): void`: `@internal`, for `PickNotice`'s timer.

Rules in `#pick` and `#applyPick`:
- **`"click"` mode** stays exactly as today: `applyPick(current, ref, mode, { additive })`.
- **`"modifier"` mode:**
  - with `e.modifier`: `toggleInSelection`;
  - without it (a plain click, or any touch tap): no selection change at all. The card still pins. With the card off, a plain click only fires `featureclick` (no error); the README says to use `"modifier"` with `card`.
- **`pickFromList(pluginId, refKey, additive)` in `"modifier"` mode:** `additive` true means `toggleInSelection`; false means no selection change.
- **The refusal hook:** when `next` differs from `current` and the plugin has `canSelect`, call it. If it returns a string, the selection is unchanged, there's no `onselectionchange`, and `notice` becomes `{ message, id: ++n }`. If it throws, log it with `console.error("map-sdk: canSelect failed", error)`, refuse, and set no notice.
- **On an allowed pick, or no change,** clear `notice`.
- Keep the plugin's `pickWith` and `canSelect` with its selection state (`PluginSelection`), carried over like `onselectionchange`. `removePlugin` forgets them.

- [ ] **Step 1: Write the failing tests:**
  - `it("modifier mode: a plain click pins and selects nothing")`, with `featureclick` still called once.
  - `it("modifier mode: Shift-click toggles in multiple mode")`: `a`, then `b`, then `a` again gives `["b"]`.
  - `it("modifier mode: Shift-click in single mode selects, then clears")`
  - `it("modifier mode: a touch tap only pins, even in multiple mode")`
  - `it("modifier mode: a list pick toggles only when additive")`
  - `it("canSelect refuses: selection unchanged, no onselectionchange, notice set")`: a cap of 1 via `canSelect: (next) => (next?.ids.length ?? 0) <= 1 || "Up to 1 monitor"`. The second Shift-click leaves the selection at `["a"]` and gives `notice.message === "Up to 1 monitor"`.
  - `it("the next allowed pick clears the notice")`
  - `it("canSelect that throws refuses quietly and logs")`
  - `it("canSelect isn't asked for setSelection or Clear")`
  - `it("togglePick toggles with the same rules and refusal, in either mode")`
  - `it("click mode with no canSelect behaves as before")`: copy two existing picking assertions (replace and additive) with `pickWith` unset.
- [ ] **Step 2:** Run `npx vitest run --project client tests/client/core/interactions.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement it.** `PluginOptions` is already exported from `src/lib/index.ts`, so the new options need no new exports.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "pickWith, canSelect, togglePick and notice"`

### Task 4: The list's additive key

**Files:**
- Modify: `src/lib/ui/FeatureList.svelte` (`onkeydown`, the `Enter`/`" "` case)
- Test: `tests/browser/feature-list.browser.test.ts`

**Interfaces:**
- Consumes: `pickFromList`'s modifier-mode rule (Task 3).
- Produces: Enter picks with `additive = e.shiftKey`, and Space stays additive. Today Enter is never additive, so in `"click"` mode Shift+Enter now adds or toggles like Shift-click. That's an intended small change, noted in the README.

- [ ] **Step 1: Write the failing test:** `it("Shift+Enter picks additively")`. With a spy on `pickFromList`, Shift+Enter on a row calls it with `additive: true`, and plain Enter with `false`.
- [ ] **Step 2:** Run `npx vitest run --project browser tests/browser/feature-list.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "FeatureList: Shift+Enter picks additively"`

### Task 5: Host buttons on the card

**Files:**
- Modify: `src/lib/view/MapView.svelte` (the `card` prop type and passing `actions`), `src/lib/ui/MapTooltip.svelte`
- Create: `src/lib/ui/card.ts` (the `CardOptions` and `CardContext` types)
- Modify: `src/lib/index.ts` (export `CardOptions` and `CardContext`)
- Test: `tests/browser/tooltip.browser.test.ts`, `tests/browser/map-view.browser.test.ts`

**Interfaces:**
- Consumes: `MapContext.togglePick` and `getSelection` (Task 3), and part 1's `pinned`.
- Produces:

```ts
export interface CardContext {
	pluginId: string;
	ref: FeatureRef;
	refKey: string;
	/** The listed item, or null for a hit its plugin doesn't list (an HMS fire hotspot). */
	item: FeatureListItem | null;
	/** Whether the feature is in its plugin's selection. Reactive. */
	selected: boolean;
	/** A user's Select/Remove: toggles the feature, with the plugin's `canSelect`. */
	toggle(): void;
}
export interface CardOptions {
	/** The host's buttons, in a row at the card's foot. */
	actions?: Snippet<[CardContext]>;
}
```

Rules:
- `MapView` takes `card?: boolean | CardOptions`. Any object counts as on, and `setCardEnabled` gets `card !== false && card !== undefined`. It passes `actions` to `MapTooltip` as a new `actions` prop.
- `MapTooltip` renders `{@render actions(ctx)}` in a `.mapsdk-card-actions` row, a flex row with a 0.5rem gap above it and theme tokens only, after the content and before the Close button in DOM order. It renders only on the interactive card, focused or pinned.
- `selected` reads `map.getSelection(pluginId)` with `selectionKeys(...).has(refKey)`.

- [ ] **Step 1: Write the failing tests:**
  - `tooltip.browser.test.ts`: `it("renders the host's actions with the card's feature and selection")`. The snippet renders a button whose text is `selected ? "Remove" : "Select"`. Pinned `a` with a selection holding `a` shows "Remove".
  - `tooltip.browser.test.ts`: `it("an action's toggle calls map.togglePick with the card's plugin and ref")`
  - `tooltip.browser.test.ts`: `it("no actions on the hover-only tooltip")`
  - `map-view.browser.test.ts`: `it("card: { actions } turns the card on and shows the buttons")`
  - `map-view.browser.test.ts`: `it("card Select past canSelect's cap shows the notice and leaves the card open")`. This needs Task 6's notice: write it here, and expect it to pass after Task 6.
- [ ] **Step 2:** Run both files. Expected: the new tests FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4:** Run both files. Expected: PASS, except the notice test, which waits for Task 6.
- [ ] **Step 5: Commit:** `git commit -am "Card: host actions with the feature's selection state"`

### Task 6: The refusal notice

**Files:**
- Create: `src/lib/ui/PickNotice.svelte`
- Modify: `src/lib/view/MapView.svelte` (render it after `ViewSummary`)
- Test: `tests/browser/map-view.browser.test.ts`, or a new `tests/browser/pick-notice.browser.test.ts`

**Interfaces:**
- Consumes: `MapContext.notice` and `clearNotice()` (Task 3).
- Produces: `PickNotice` with prop `{ map: MapContext }`.
  - A `role="status"` element (`aria-live="polite"`, `aria-atomic="true"`) that is always in the DOM. A live region must exist before its text changes.
  - It shows `notice.message` while `notice` is set, positioned absolutely, bottom center, `bottom: 2.5rem` (above the credits), `z-index: 3`.
  - Styled like the list button: theme tokens `--background`, `--foreground`, `--card-border`, `--radius-control`, `--shadow-card`.
  - It clears through `map.clearNotice()` 4000 ms after each new `notice.id`. There's no animation, so reduced motion needs nothing more.

- [ ] **Step 1: Write the failing tests:**
  - `it("announces a refusal and clears it after 4 s")`, with fake timers: after a refusal, the status element has the message; after `vi.advanceTimersByTime(4000)`, it's empty.
  - `it("the same message twice is announced again")`: the `id` changes, so the text node is re-rendered (key it on `id`).
  - `it("one map's notice doesn't show on another")`
  - Task 5's notice test now passes.
- [ ] **Step 2:** Run the browser test files. Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4:** Run them, then `npm test && npm run test:bundle`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "PickNotice: refused picks are shown and announced"`

### Task 7: Demo and e2e

**Files:**
- Modify: `demo/App.svelte`. On the Live map (`right`), its monitors plugin gets `pickWith: "modifier"` and `canSelect` with a cap of 3 (`"Up to 3 monitors"`, the demo's own text). The card gets `{ actions }` with one button, `selected ? "Remove" : "Select"`, calling `toggle`. The setup map (`today`) is unchanged.
- Modify: `e2e/demo.spec.ts`

- [ ] **Step 1: Write the e2e tests.** Zoom with `zoomTo` first, as part 1's tests do; Fixture Echo (`[-119.76121, 36.82034]`) is the second monitor near Alpha at zoom 12. Use zoom 12 with both points in view, or zoom to each in turn.
  - `"modifier: a plain click pins and selects nothing"`
  - `"modifier: Shift-click selects, Shift-click again removes"`: read the selection via `__mapsdkDemo.right.getSelection("monitors")`.
  - `"modifier: the card's Select and Remove"`
  - In the touch describe: `"modifier: a tap pins only; the card's Select selects"`.
  - `"a pick past the cap is refused with an announced message"`: set the selection to 3 ids through `__mapsdkDemo.right.setSelection`, then Shift-click Alpha. `getByRole("status")` has "Up to 3 monitors", and the selection is unchanged.
- [ ] **Step 2:** Run `npx playwright test --project chromium --project firefox`. Expected: all pass, including part 1's.
- [ ] **Step 3: Commit:** `git commit -am "Demo: modifier-select with a cap and card buttons on the Live map; e2e"`

### Task 8: Docs, version, PR

**Files:**
- `README.md`:
  - the Selection section: `pickWith`, `canSelect`, `togglePick`, and the notice;
  - the MapView section: `card`'s `CardOptions` and `CardContext`;
  - "Changes" for `0.1.0-beta.9`: the new API, and Shift+Enter in the list now picking additively.
- `tests/unit/readme-examples.test.ts`, if an example is added.
- `CLAUDE.md`:
  - the Core and View lines (the new options, `togglePick`, `notice`, `PickNotice`);
  - **replace the "Rules that cross repos" docs bullet**, now: "Record every deferral in data-dashboard's `DEFERRED.md` ... never its main checkout. Docs-only commits go straight to its `main` (fetch and rebase first)." The new text, as the user approved it on 2026-11-11:

> Record every deferral in data-dashboard's `DEFERRED.md`, with why and a revisit trigger, and keep map-sdk's status in `TODO.md` current. Edit data-dashboard docs only in your own worktree, never its main checkout, and on its current working branch: `origin/main`'s `TODO.md` → "Start here" names it (a step's branch while that step runs, otherwise `main`). Make the worktree from that branch (`git worktree add --detach .worktrees/docs-<track> origin/<branch>`), commit, `git pull --rebase origin <branch>`, then `git push origin HEAD:<branch>`.

- `package.json` and `package-lock.json`: `0.1.0-beta.9`.

- [ ] **Step 1:** Make the edits. Run `npm run format`.
- [ ] **Step 2:** Run `npm run lint && npm run check && npm test && npm run test:bundle && npm run test:licenses && npx playwright test --project chromium --project firefox`. Expected: all pass.
- [ ] **Step 3: Commit:** `git commit -am "0.1.0-beta.9: card buttons, modifier-select, refusing a pick; CLAUDE.md docs branch rule"`
- [ ] **Step 4:** Final whole-branch review, then push and open the PR into `main` (no AI attribution). Tell the coordinator about the PR and the new API, and update map-sdk's row in data-dashboard's `TODO.md` on its current working branch. The merge and the release each wait for the user's yes.
