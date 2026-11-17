# Pin in place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `MapContext.pin(pluginId, refKey, { anchor? })` swaps the pinned card for another
listed feature's card in place: no camera move, a held lens stays held, focus moves to the new
card. Released as `0.1.0-beta.20`.

**Architecture:** `pin` sets `CreatedMap.#pinned` from the plugin's listed item. `lens-state`
carries an existing hover hold across a card change to the centre parent. `MapTooltip` moves
focus to the card element when the pinned feature changes while focus was inside it.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (client + browser projects).

**Spec:** `docs/superpowers/specs/2026-11-17-pin-in-place-design.md`

## Global Constraints

- Hosts that never call `pin` see no change (every existing test passes unchanged).
- No hardcoded UI strings: any new text is a `mapsdk_*` key in `messages/en.json` (none
  expected).
- Tabs, double quotes, no trailing commas, width 100; `npm run format` before each commit.
- Run `npm run test:bundle` before committing changes under `src/lib`.
- Prove each new test can fail by breaking the code under test (revert after).
- Hover-sensitive browser files call `parkPointer()` in `afterEach` (lens and tooltip files
  already do).
- No AI attribution in commits.

## Review Focus

1. `pin` while a list row is keyboard-focused: the focused item keeps the card; `pinned` changes
   underneath. Expect no throw and no focus clear (Task 1 test).
2. `pin` to the feature already pinned: no change of anchor, and no focus jump (Task 1, Task 3
   tests).
3. A card swap when focus was _not_ inside the card (mouse click, Safari): focus stays put
   (Task 3 test).
4. Close/Esc after a swap returns focus to the origin from before the first card, not to the
   removed button (Task 3 test).
5. The lens after the swap: the pointer leaving the card onto another township keeps the lens on
   the old centre; closing the township card lets the hover take over (Task 2 and Task 4 tests).

---

### Task 1: `MapContext.pin`

**Files:**

- Modify: `src/lib/core/create-map.svelte.ts` (interface near `unpin()` ~line 225; class near
  `unpin()` ~line 485)
- Test: `tests/client/core/interactions.test.ts` (`describe("pinned card")`, ~line 851)

**Interfaces:**

- Produces:
  `pin(pluginId: string, refKey: string, options?: { anchor?: [number, number] }): boolean` on
  `MapContext` and `CreatedMap`.

- [ ] **Step 1: Write the failing tests** in `describe("pinned card")`, using its `cardSetUp`,
      `item()` and `rendered()` helpers (give the `monitors` plugin `features: () => [item("a"),
item("b")]` where the setup doesn't already list them):

```ts
it("pin() pins a listed feature at the open card's anchor, with no move or featureclick", ...)
//   click a → pinned a at [-119, 36]; spy gl.easeTo/flyTo/jumpTo and a featureclick handler;
//   expect(map.pin("monitors", "monitor:b")).toBe(true);
//   pinned.hit → { pluginId: "monitors", ref: item("b").ref, refKey: "monitor:b", name: "Site b" }
//   pinned.lngLat → [-119, 36] (the click point, not b's lngLat; give b lngLat [-118, 35])
//   no camera call, no featureclick, getSelection unchanged, focusedKey null
it("pin() with no card open uses anchorFor(item); options.anchor wins over both", ...)
//   nothing pinned → pin b → lngLat equals map.anchorFor(item b);
//   pin("monitors","monitor:a",{ anchor: [-117, 34] }) → lngLat [-117, 34]
it("pin() refuses with the card off, an unknown plugin, hoverable: false, or an unlisted key", ...)
//   each returns false and leaves pinned as it was
it("pin() while a list row is focused sets pinned and leaves the focus", ...)
//   focusFeature("monitor:a") then pin b → true; focusedKey still "monitor:a"; pinned b
it("pin() refuses after destroy", ...)
```

- [ ] **Step 2: Run** `npx vitest run --project client tests/client/core/interactions.test.ts`
      Expected: FAIL, `map.pin is not a function`.

- [ ] **Step 3: Implement `pin`.** Find the item with `untrack(() => this.#findItem(refKey,
pluginId))` and require `found.plugin.id === pluginId`; refuse when `#destroyed`,
      `!#cardEnabled`, or `plugin.hoverable === false`. `lngLat = options?.anchor ??
untrack(() => this.#pinned)?.lngLat ?? this.anchorFor(item)`. Copy the anchor array. Set
      `#pinned = { hit: { pluginId, ref: item.ref, refKey: item.refKey, name: item.name }, lngLat }`.
      Doc comment on the interface: what it does, what it leaves alone, the refusals, and "a
      focused list row's item still shows first".

- [ ] **Step 4: Run** the same command. Expected: PASS. Break the anchor fallback (use
      `anchorFor` always) and see the first test fail; restore.

- [ ] **Step 5: Commit** `feat: MapContext.pin pins a listed feature's card in place`

### Task 2: A held hover lens carries over to its centre parent's card

**Files:**

- Modify: `src/lib/plugins/lens-state.svelte.ts` (`run()`, the `held = ...` line)
- Test: `tests/client/plugins/lens-state.test.ts`

**Interfaces:**

- Consumes: nothing new (`LensInputs` unchanged).

- [ ] **Step 1: Write the failing tests** (the file's `lens()`, `hover()`, `step()`):

```ts
it("a held lens stays held when the card moves to its centre township", ...)
//   parentHover T1; step; card = hover("lens","T1-S2"); step; held true
//   card = hover("parents","T1"); step; held true
//   parentHover = hover("parents","T3"); step(1000); center "T1"
//   card = null; step; held false; center "T3"
it("the carried hold ends when the card moves on to another township", ...)
//   ...held via section, card → T1 (held), card → hover("parents","T2"); step;
//   held false; parentHover T3 → center "T3"
it("a centre township's card that didn't come from a held card doesn't hold", ...)
//   guard: parentHover T1; card T1 (no prior hold); held false; parentHover T2 → center "T2"
it("list focus moving the held card to the centre township doesn't carry the hold", ...)
//   held via section; inputs.focused = "T1"; card T1; step; held false
```

Check `FakeLensInputs` for the focused-key field's name and use it.

- [ ] **Step 2: Run** `npx vitest run --project client tests/client/plugins/lens-state.test.ts`
      Expected: the first two FAIL (held false after the card moves to T1); the guards pass.

- [ ] **Step 3: Implement.** In `run()`, compute
      `const carried = held && !focused && card?.hit.pluginId === inputs.parentsId &&
card.hit.refKey === center;` before `held` is reassigned, then
      `held = center !== null && (holdsLens(card) || carried);`. Update the comment above it.

- [ ] **Step 4: Run** the file. Expected: PASS, including every existing test. Remove `!focused`
      and see the list-focus test fail; restore.

- [ ] **Step 5: Commit** `feat(lens): a held hover lens stays held on its centre township's card`

### Task 3: Focus moves to the swapped card

**Files:**

- Modify: `src/lib/ui/MapTooltip.svelte`
- Test: `tests/browser/tooltip.browser.test.ts` (new `describe("MapTooltip card swap")`)

**Interfaces:**

- Consumes: Task 1's `map.pin`.

- [ ] **Step 1: Write the failing tests** with a real map, so `pinned` is reactive:
      `createMap({ config: { maptilerKey: "k" } })`, `map.setCardEnabled(true)`, and a plugin
      `{ id: "points", setup: () => () => {}, features: () => sites(), tooltip }` whose
      `tooltip(item)` is a raw snippet rendering `<button type="button">Go to Site B</button>`
      for Site A that calls `map.pin("points", "b")` on click, and plain text for Site B. Pin A with
      `map.pin("points", "a")`; render `MapTooltip` with `{ map, project, card: true }`.

```ts
it("moves focus to the new card when its button swaps the card", ...)
//   before button focused; Tab to "Go to Site B"; Enter;
//   group "Site B" visible; document.activeElement === that group's element;
//   the group has tabindex "-1"; axe on the card: no violations
it("Close after a swap returns focus to where it came from before the card", ...)
//   as above, then Tab to Close, Enter → activeElement === before
it("a swap with focus outside the card leaves focus where it is", ...)
//   focus an outside button; map.pin("points","b") from code; await tick;
//   activeElement is still the outside button
it("pinning the feature already pinned doesn't move focus", ...)
//   Tab to Close (focus inside); map.pin("points","a"); Close keeps focus
```

- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/tooltip.browser.test.ts`
      Expected: the first two FAIL (focus on `body` after the swap); the guards pass.

- [ ] **Step 3: Implement.** Add `tabindex="-1"` and the `mapsdk-focus` class to the card `div`
      (check `controls.css` that `mapsdk-focus` draws a `:focus-visible` ring on a non-button; add
      the selector if not). Track the pinned identity
      (`${pinned.hit.pluginId}\n${pinned.hit.refKey}`) in an `$effect`; when it changes to another
      non-null key while `focusInside` is true, after `tick()` focus `cardEl` if focus isn't
      inside it already. `focusInside` survives the button's removal because `onfocusout` clears
      it a microtask later only if focus isn't back in the card; make sure the effect reads it
      before then (run the check in the effect body, focus after `tick()`), and keep `origin`
      untouched. Never read a prop in the effect's cleanup.

- [ ] **Step 4: Run** the file. Expected: PASS. Remove the focus call and see the first test
      fail; restore. Run `taskset -c 0,1 npx vitest run --project browser` 5 times: all green.

- [ ] **Step 5: Commit** `feat(card): focus moves to the card when pin swaps it`

### Task 4: The lens end to end, docs, and the version

**Files:**

- Test: `tests/browser/lens.browser.test.ts`
- Modify: `README.md` (the card paragraph ~line 147, the `shapesLens` "Pinning" bullet ~line
  299, the example after it, a new `### 0.1.0-beta.20` under "Changes"),
  `tests/unit/readme-examples.test.ts` (the shapesLens example ~line 111), `CLAUDE.md` (core
  line: `pinned`/`unpin()` gains `pin()`; lens line: the carried hold), `package.json` and
  `package-lock.json` (`0.1.0-beta.20`)

- [ ] **Step 1: Write the test.** Give `lensMap` an option `inTownship = false`; when on, the
      section `tooltip` is `(item) => snippet` rendering `<button type="button">In township</button>`
      that calls `map.pin("parents", <the section's parent refKey>)` (from the fixture's
      `parentOf`, or the refKey's `T<r>-<c>` prefix).

```ts
it("a section card's township button swaps in its township's card and keeps the hover lens", ...)
//   pointAt(at(2,2)); waitFor center T2-2; clickAt(at(2,2,3)); section group "T2-2 S3";
//   camera = gl.getCenter(); click "In township";
//   group "T2-2" visible and focused? (mouse click: don't assert focus); section group gone;
//   gl.getCenter() unchanged; pointAt(at(4,4)); settle(300); lens.center still T2-2;
//   press Escape → card closes; pointAt(at(4,4)) → center T4-4
it("keyboard: the township button moves focus into the township's card", ...)
//   pin the lens via the township card's Show square miles, Tab into a section card's button
//   (reach it by focusing a section row in the list, Tab to the card), Enter →
//   activeElement is group "T…"; lens.pinned still true
```

- [ ] **Step 2: Run** `npx vitest run --project browser tests/browser/lens.browser.test.ts`
      Expected: PASS (Tasks 1–3 done). Break Task 2's carry and see the first test fail; restore.

- [ ] **Step 3: Docs.** README card paragraph: `map.pin(pluginId, refKey, { anchor? })` and what
      it leaves alone and refuses. "Pinning" bullet: the carried hold. Example: a section `tooltip`
      with an "In township" button calling `map.pin("townships", townshipOf(item.ref ...))`
      (keep it short; type-checked). Mirror it in `readme-examples.test.ts` and assert
      `map.pin("townships", "x")` returns `false` on a map without the card. Changes entry for
      beta.20: **New API** `MapContext.pin`; **`shapesLens`** the carried hold; **Card** focus
      moves to the card on a swap. CLAUDE.md lines. Bump the version (`npm version
0.1.0-beta.20 --no-git-tag-version`).

- [ ] **Step 4: Verify** `npm run check && npm run lint && npm test && npm run test:bundle &&
npm run test:licenses && npx playwright test --project chromium --project firefox`
      Expected: all pass.

- [ ] **Step 5: Commit** `0.1.0-beta.20: pin another feature's card in place`
