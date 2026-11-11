# Pinned reading card (part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With a new `MapView` prop `card`, a click or tap on a feature pins its reading card, which takes the pointer, has a close button, and closes with Esc or a click elsewhere. Focusing a feature-list row shows the same card. Ships alone as `@sjvair/map-sdk` `0.1.0-beta.8`.

**Architecture:** `MapContext` gains a reactive `pinned` (the same shape as `hovered`), set by map clicks and list focus while the card is enabled, and cleared by misses, Esc, and the close button. `InteractionRouter` reports clicks that hit nothing (and clicks on cluster bubbles) so a click elsewhere unpins. `MapTooltip` shows focused, then pinned, then hovered. While the card is on it renders the interactive card, after the list in DOM order so Tab reaches it from the list.

**Tech Stack:** Svelte 5 runes, TypeScript, MapTiler SDK 4.2 (MapLibre), Vitest (unit, client, browser projects), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-options-toolbar-and-widget-needs-design.md`, section "1. Pinned reading card", and "Order of work".

Parts 2–5 of the spec each get their own plan when they start, built on what this part ships.

## Global Constraints

- Opt-in: with `card` unset (default `false`), every map behaves exactly as in `0.1.0-beta.7`. monitor-map never sets it.
- **The card never changes selection rules.** A click still selects exactly as today *and* pins the card, and a tap in `"multiple"` mode still adds. `featureclick` still fires for every click.
- Part 2 adds host buttons without a break: the prop's type is `card?: boolean` now and widens to `boolean | CardOptions` later.
- Every UI string is a `mapsdk_*` key in `src/lib/data/messages/en.json`. Theme tokens only (`CLAUDE.md`'s list). Respect `prefers-reduced-motion`.
- Nothing module-global: two maps on a page never share a card.
- Code style: tabs, double quotes, no trailing commas, print width 100, Svelte 5 runes only. Import rune modules with `.svelte.js`.
- Before each commit under `src/lib`: `npm run lint && npm run check && npm test && npm run test:bundle`.
- No Claude or AI attribution in commits, the PR, or docs. No push, PR merge, or release without the user's yes (each release a separate yes).

## Review Focus

1. **A tap right after its own emulated `mousemove`** (the hover card already showing, then the `click`): the card ends pinned and stays, on Chromium, Firefox, and WebKit. Pinned in Task 6's e2e.
2. **The pinned feature leaves the data** (a poll drops the monitor, or the plugin is removed or hidden): the card closes, with no stale card and no focus left on a removed node. Pinned in Task 3 (plugin removed) and Task 4 (item gone).
3. **Two maps on one page:** pinning, Esc, and the close button on one never touch the other's card. Pinned in Task 3 and Task 6.
4. **The map moves so the card's anchor leaves the view:** the card hides and comes back when the anchor returns, and it never draws outside the map's box. Pinned in Task 4.
5. **Closing returns focus to where it came from, and that node is gone** (the list panel closed meanwhile): focus goes to the map region, never to `body`. Pinned in Task 4.

---

### Task 0: Branch and spec

**Files:**
- Add: `docs/superpowers/specs/2026-11-11-options-toolbar-and-widget-needs-design.md`, `docs/superpowers/plans/2026-11-11-pinned-card.md` (both already written)

- [ ] **Step 1:** `git fetch origin && git switch -c feat/pinned-card origin/main`
- [ ] **Step 2: Commit the spec and this plan**

```bash
git add docs/superpowers/specs/2026-11-11-options-toolbar-and-widget-needs-design.md docs/superpowers/plans/2026-11-11-pinned-card.md
git commit -m "Spec: options toolbar, pinned card, selection, focus area, schools; plan for the pinned card"
```

### Task 1: Find why a tap hides the hover card

The pin fixes the symptom, but the cause decides whether Task 3's pin also needs to survive a trailing event. Use superpowers:systematic-debugging. This task is investigation only, with no product code.

**Files:**
- Temporary: an e2e spec in `e2e/` that logs the event sequence (deleted at the end of the task)

- [ ] **Step 1:** In the demo, with Playwright `hasTouch: true` on Chromium and WebKit, tap a monitor on the "Live map" and log, in order, the GL map's `mousemove`, `mouseout`, `click`, `touchstart`, and `touchend`, plus every write to `InteractionRouter.#hovered` (add a temporary `console.debug` there). The monitor's screen point comes from Task 6's `window.__mapsdkDemo` hook: add that hook here first if you need it.
- [ ] **Step 2:** Write down which event clears `hovered` after the click (expected suspects: a `mouseout` fired by the touch sequence, or a `mousemove` at a point that misses the feature). Record it in the PR description.
- [ ] **Step 3:** If the event that clears `hovered` comes *after* `click`, Task 3's pin must not depend on `hovered` (it doesn't, as designed). Note this in Task 3's PR notes. Remove the temporary logging and the spec. No commit.

### Task 2: The router reports misses

**Files:**
- Modify: `src/lib/core/interactions.svelte.ts` (`#onClick`, new `onMiss`)
- Test: `tests/client/core/interactions.test.ts`

**Interfaces:**
- Produces: `InteractionRouter.onMiss(handler: () => void): () => void`. It's called for a click with no hits, and for a click on a blocking layer (after that layer's `onClick`). It isn't called for a click with hits. It returns an unsubscribe function.

- [ ] **Step 1: Write the failing tests** in a `describe("misses")` block:
  - `it("calls onMiss for a click that hits nothing")`: no rendered features, `click(gl)`, so the handler is called once.
  - `it("calls onMiss after a blocking layer's onClick")`: a blocking registration (copy the cluster-bubble setup used elsewhere in this file) is topmost, so `onClick` is called and then `onMiss` is called once.
  - `it("doesn't call onMiss for a click with hits")`
  - `it("stops calling after unsubscribe")`
- [ ] **Step 2:** Run `npx vitest run --project client tests/client/core/interactions.test.ts`. Expected: the four new tests FAIL (`onMiss` is not a function).
- [ ] **Step 3: Implement `onMiss`.** Use a handler set like `#pickHandlers`, with the same try/catch logging (`"map-sdk: a miss handler failed"`).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "InteractionRouter reports clicks that hit nothing"`

### Task 3: `MapContext.pinned`

**Files:**
- Modify: `src/lib/core/create-map.svelte.ts` (interface and `MapContextImpl`: `#pick`, `focusFeature`, `removePlugin`, `detach`, `destroy`)
- Test: `tests/client/core/create-map.test.ts` (new `describe("pinned card")`)

**Interfaces:**
- Consumes: `InteractionRouter.onMiss` (Task 2); `Hovered` from `interactions.svelte.ts`.
- Produces, on `MapContext`:
  - `readonly pinned: Hovered | null`: reactive. The pinned feature's hit and anchor. `null` while the card is off.
  - `setCardEnabled(on: boolean): void`: `@internal`, for `MapView` only. Turning it off also unpins.
  - `unpin(): void`: public. Closes the card (a host may call it, e.g. after its own action). Does nothing when nothing is pinned.

Rules for `MapContextImpl`:
- In `#pick` (map click), when the card is enabled and the top hit's plugin isn't `hoverable: false`, set `pinned = { hit: hits[0], lngLat: e.lngLat }`. Do this after `#emitClick` and `#applyPick`, which stay unchanged. A click whose top hit is on a `hoverable: false` plugin (smoke) unpins.
- `onMiss`, with the card enabled: unpin.
- `focusFeature(refKey, pluginId)`, with the card enabled and the item found: set `pinned` to that item's hit (`{ pluginId, ref, refKey, name }`) at `focusedAnchor`. `focusFeature(null)` leaves `pinned` alone, so focus leaving the list into the card keeps the card.
- `pickFromList` pins the same way (it goes through `focusFeature` or `#emitClick`; pin once, not twice).
- `removePlugin(id)`, `detach()`, and `destroy()` unpin when the pinned hit belongs to that plugin, or always for `detach` and `destroy`.

- [ ] **Step 1: Write the failing tests** (use `setUp`, `rendered`, and `click` as in `interactions.test.ts`):
  - `it("doesn't pin while the card is off")`: click a feature, so `pinned` is `null`.
  - `it("pins the clicked feature at the click point")`: after `setCardEnabled(true)`, the clicked feature has `pinned.hit.refKey === "monitor:a"` and `pinned.lngLat` equals `[-119, 36]`.
  - `it("still selects and fires featureclick exactly as without the card")`: in `"multiple"` mode, a plain click selects `["a"]`, and a touch click (`originalEvent: { pointerType: "touch" }`) on `b` adds it (`["a", "b"]`). `featureclick` is called twice, and the card is pinned on `b`.
  - `it("moves the pin on a click on another feature")`
  - `it("unpins on a click that hits nothing")`
  - `it("unpins on a click on a non-hoverable plugin's feature")`
  - `it("pins a focused list item and keeps it when focus clears")`: `focusFeature("monitor:a", "monitors")` gives `pinned.hit.refKey === "monitor:a"`, and after `focusFeature(null)` it's still pinned.
  - `it("unpins when the pinned feature's plugin is removed")`
  - `it("setCardEnabled(false) unpins")`
  - `it("unpin() clears it, and does nothing when nothing is pinned")`
  - `it("two maps never share a pin")`: two `createMap`s on two fake GLs; pinning on one leaves the other's `pinned` `null`.
- [ ] **Step 2:** Run `npx vitest run --project client tests/client/core/create-map.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the interface and rules above. `#pinned` is `$state.raw<Hovered | null>`. Subscribe `onMiss` in the constructor, next to `onPick`. Doc comments follow the file's style (say what's reactive, and what's for MapView only).
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS, with no other test changed.
- [ ] **Step 5: Commit:** `git commit -am "MapContext.pinned: clicks and list focus pin a feature while the card is on"`

### Task 4: The card in `MapTooltip`

**Files:**
- Modify: `src/lib/ui/MapTooltip.svelte`
- Modify: `src/lib/data/messages/en.json`: add `"mapsdk_card_close": "Close"`
- Test: `tests/browser/tooltip.browser.test.ts` (new `describe("card")`; extend its `fakeMap` with `pinned`, `unpin`, and a `card` state)

**Interfaces:**
- Consumes: `MapContext.pinned` and `unpin()` (Task 3).
- Produces: a new `MapTooltip` prop `card?: boolean` (default `false`). `MapView` passes it in Task 5.

Behavior with `card` true:
- **What shows:** focused, then pinned, then hovered. A hover never shows while something is pinned. With `card` false, nothing changes: the existing tests must pass untouched.
- **Anchor:** a pinned hit is anchored like a hovered one in `"pinned"` mode (the item's `lngLat`, or `anchorFor(item)` for a shape whose label point is off-screen, recomputed when `map.bounds` changes), whatever `mode` is.
- **Off-screen:** when the projected anchor is outside `0..width` × `0..height`, don't render the card. It returns when the anchor is back.
- **Feature gone:** when the pinned hit's plugin lists features but no longer lists the pinned `refKey`, call `map.unpin()` from an `$effect`.
- **Markup:**
  - The card takes pointer events (`pointer-events: auto`), with `role="group"` and `aria-labelledby` set to its name element's id (`$props.id()`).
  - It ends with a close button: `aria-label={messages("mapsdk_card_close")}`, an "×" glyph with `aria-hidden`, the `mapsdk-focus` class, and theme tokens only.
  - The hover-only tooltip keeps `role="tooltip"` and `pointer-events: none`.
- **Focus:**
  - Never move focus into the card yourself.
  - On `focusin` from outside the card, remember `event.relatedTarget`.
  - On close (button or Esc inside the card), call `map.unpin()`, then focus the remembered element if it's still connected. Otherwise focus the map region (`closest("[data-mapsdk-map]")`, which `MapView` makes focusable from script).
- **Esc inside the card:** close it, and `stopPropagation` so the list panel's Esc handler doesn't also run.

- [ ] **Step 1: Write the failing tests:**
  - `it("shows a pinned feature with a Close button, and takes the pointer")`
  - `it("hides the hover while something is pinned")`: `hovered` on `b`, `pinned` on `a`, so the card shows `a`'s name only.
  - `it("prefers the focused item over the pinned one")`
  - `it("close button unpins and returns focus to where it came from")`: focus a button outside, Tab into the card, click Close. `unpin` is called once, and focus is back on that button.
  - `it("returns focus to the map region when the origin is gone")`
  - `it("Escape inside the card closes it and doesn't bubble")`
  - `it("hides while its anchor is off-screen")`: `project` returns `{ x: -50, y: 100 }`, so there's no card. When it returns to `{ x: 100, y: 100 }`, the card is shown.
  - `it("unpins when the pinned item leaves the plugin's features")`
  - `it("with card off, a pinned value is ignored and the tooltip keeps role=tooltip")`
- [ ] **Step 2:** Run `npx vitest run --project browser tests/browser/tooltip.browser.test.ts`. Expected: the new tests FAIL, and the existing ones pass.
- [ ] **Step 3: Implement** the behavior above in `MapTooltip.svelte`, and add the message key.
- [ ] **Step 4:** Run the same command, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "MapTooltip: an interactive pinned card while the card is on"`

### Task 5: `MapView`'s `card` prop

**Files:**
- Modify: `src/lib/view/MapView.svelte`
- Test: `tests/browser/map-view.browser.test.ts` (or a new fixture host in `tests/fixtures/` if the existing hosts can't pass the prop)

**Interfaces:**
- Consumes: `MapContext.setCardEnabled` (Task 3), `MapTooltip`'s `card` prop (Task 4).
- Produces: `MapView` prop `card?: boolean`, default `false`. Doc comment: "`true`: a click or tap on a feature pins its reading card, which takes the pointer and closes with Esc, its Close button, or a click elsewhere on the map; focusing a feature-list row shows the same card. Selection and `featureclick` are unchanged."

Rules:
- An `$effect` calls `map.setCardEnabled(card)`, with `setCardEnabled(false)` on cleanup. It sets no plugins up, so it's safe in an effect, per `2026-11-07-plugin-setup-outside-effects-design.md`.
- Move `<MapTooltip>` after the list panel block (before the selection bar), so Tab from the feature list reaches the card next. Pass `card`. Check that hover stacking is unchanged: the tooltip keeps `z-index: 1` and the list panel `z-index: 2`. When the card is pinned it must sit above the list panel, so give the pinned card `z-index: 3`.
- Esc when focus isn't inside the card: in the list panel's `onListKeydown`, if `map.pinned` is set, unpin and `preventDefault`, and don't close the panel (the next Esc closes it). On `svelte:window`, an Esc with `map.pinned` set unpins only when `document.activeElement` is inside this map's root or is `document.body`.

- [ ] **Step 1: Write the failing tests:**
  - `it("card off by default: a click doesn't pin")`
  - `it("card: Escape in the list closes the card first, then the panel")`
  - `it("card: Tab from the focused list row reaches the card's Close button")`
  - `it("card: Escape with focus in another map leaves this card open")`
- [ ] **Step 2:** Run `npx vitest run --project browser tests/browser/map-view.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the rules above.
- [ ] **Step 4:** Run the same command, then `npm test && npm run test:bundle`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "MapView: card prop"`

### Task 6: Demo and e2e

**Files:**
- Modify: `demo/App.svelte`: `card` on the "Live map" (`right`), not on the monitor-map setup map. In dev only, `window.__mapsdkDemo = { left, right, today }` (the `MapContext`s), so e2e can project a monitor to a screen point.
- Modify: `e2e/demo.spec.ts`

- [ ] **Step 1: Write the failing e2e tests.** Add a helper `monitorPoint(page, mapName, lngLat)` that returns the page coordinates from `window.__mapsdkDemo[mapName].gl.project(lngLat)` plus the canvas's bounding box. Use the fixture monitor ALPHA's coordinates from `e2e/fixtures/monitors.json`.
  - `test.describe("card, touch", () => { test.use({ hasTouch: true }); ... })` with `test("a tap on a monitor pins its card, and it stays")`: `page.touchscreen.tap(x, y)`, so the card (`getByRole("group", { name: /Fixture Alpha/ })`) is visible, and still visible after `page.waitForTimeout(500)`.
  - `test("a click pins the card; a click on empty map closes it")`
  - `test("Escape closes the card")`, and `test("the Close button closes it and the selection is unchanged")`
  - `test("keyboard: a list row shows the card; Tab reaches Close; Escape returns to the row")`
  - `test("the monitor-map setup map doesn't pin on click")`: a click on a monitor there leaves no `group` card.
  - In the existing axe test, add a pinned card on the Live map before the scan, in both themes.
- [ ] **Step 2:** Run `npx playwright test --project chromium --project firefox`. Expected: the new tests PASS once Tasks 2–5 are in. Before the demo change, they FAIL (no card). WebKit runs in CI.
- [ ] **Step 3: Implement** the demo change.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "Demo: the Live map pins its card; e2e for tap, click, keyboard, and Esc"`

### Task 7: Docs, version, PR

**Files:**
- Modify: `README.md`: the `card` prop and `MapContext.pinned` / `unpin()` in the API section. Add a "Changes" entry for `0.1.0-beta.8`: what changed (tap and click pin the reading card when `card` is on), that nothing changes without it, and the new key `mapsdk_card_close`.
- Modify: `tests/unit/readme-examples.test.ts`, if the README gains an example.
- Modify: `CLAUDE.md`: mention the `card` prop in the View line and `pinned`/`unpin` in the Core line.
- Modify: `package.json`: `"version": "0.1.0-beta.8"` (and the lockfile's matching line).

- [ ] **Step 1:** Make the edits above. Run `npm run format`.
- [ ] **Step 2:** Run `npm run lint && npm run check && npm test && npm run test:bundle && npm run test:licenses && npx playwright test --project chromium --project firefox`. Expected: all pass.
- [ ] **Step 3: Commit:** `git commit -am "0.1.0-beta.8: pinned reading card"`
- [ ] **Step 4:** Ask the user before pushing and opening the PR. On a yes, push and open the PR into `main`. The description covers: what, why (the dashboard's tap bug and Task 1's finding), that it's opt-in, and the test plan. No AI attribution.
- [ ] **Step 5:** Tell the coordinator the PR number and the new API. Update map-sdk's status in data-dashboard's `TODO.md` on `step-5`, through the worktree `.worktrees/docs-map-sdk`. Merging needs the user's yes, and the release is a separate yes.
