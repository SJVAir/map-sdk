# Lens hides on load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `shapesLens` applies its hidden-townships set in the frame the sections' tiles load, so
neither newly covered townships flash clear nor left ones show under old sections.

**Architecture:** In `shapesLens`'s setup, the hide effect stores the wanted set as pending. A
microtask, a `sourcedata` listener and an `error` listener on `ctx.gl` apply it to `hooks.setHidden`
once the inner source (`ctx.id("shapes")`) has loaded. `GlMapLike` gains `isSourceLoaded`.

**Tech Stack:** Svelte 5 runes, MapLibre 5.24 via `@maptiler/sdk` ~4.2.0, Vitest (client, browser).

**Spec:** `docs/superpowers/specs/2026-11-17-lens-hide-on-load-design.md`

## Global Constraints

- Every current lens rule is kept: hover, `pin`/`release`, Esc, card holds, `map.pin`'s swap in place.
- No message-key changes. Version `0.1.0-beta.21`.
- Tabs, double quotes, no trailing commas. Run `npm run check` before each commit, and run
  `npm run test:bundle` before committing anything under `src/lib`. No attribution trailers.

## Review Focus

- A recentre before the previous load finishes: only the latest set applies (Task 1, test c).
- A failed load leaves no township stuck hidden or shown (Task 1, test d).
- Hidden-set changes that bring no new section data (parents reload, scale resolving) still apply
  at once rather than waiting forever (Task 1, test e).
- A restyle or removal with a load pending: hidden cleared and the listeners removed, so no late
  `setHidden` after teardown (Task 1, test f).
- The existing pinned-lens release when `parents` goes `features: null` keeps working: covered by
  the existing client suite, run unchanged.

---

### Task 1: Pending hidden set, applied on load

**Files:**
- Modify: `src/lib/core/gl.ts` (add to `GlMapLike`), `tests/fixtures/fake-gl.ts`,
  `src/lib/plugins/shapes-lens.svelte.ts` (the hide effect, around `hooks.setHidden(parents)`, and
  teardown)
- Test: `tests/client/plugins/shapes-lens.test.ts`

**Interfaces:**
- Produces: `GlMapLike.isSourceLoaded(id: string): boolean`.
- Produces in `FakeGl`: `holdData: boolean` (default `false`). While true, a `setData` adds the
  source to `loading`. `isSourceLoaded(id)` is `!loading.has(id)`. `finishData(id)` deletes it
  and emits `sourcedata` `{ sourceId: id, isSourceLoaded: true, tile: {} }`.
  `failData(id)` deletes it and emits `error` `{ sourceId: id, error: new Error("fake") }`.
  Existing tests keep `holdData` false, so they apply at once as today.

- [ ] **Step 1: Write the failing client tests** (new `describe("hides on load")`; each sets
  `gl.holdData = true` after `setUp`. `src` is the inner source's id, the `gl.sources` key ending
  `:lens:shapes`):
  - a. `"keeps the old hidden set until the sections' tiles load, then applies it whole"`:
    pin (2,2), finishData, settle → 9 hidden. Pin (2,3): settle → still the (2,2) block's 9.
    `finishData(src)` → the (2,3) block's 6 (cols 2–4 clipped at the 5×5 grid's edge).
  - b. `"a metadata or content event doesn't apply it"`: after the pin (2,3), emit `sourcedata`
    `{ sourceId: src, isSourceLoaded: true, sourceDataType: "metadata" }`, then the same with
    `"content"` → unchanged.
  - c. `"a second recentre before the load applies only the latest"`: pin (2,3), then pin (3,3),
    emit a `tile` event with `isSourceLoaded: false` → unchanged. Then finishData → (3,3)'s block.
  - d. `"an error on the sections' source applies the pending set"`: pin (2,3), `failData(src)`
    → (2,3)'s block.
  - e. `"a change that brings no new sections applies at once"`: with nothing loading,
    `parentsSource.features` set to drop `parentKey(2,2)` → hidden drops it after `settle()`,
    with no `finishData`.
  - f. `"teardown with a load pending clears the hidden set and ignores later loads"`: pin (2,3),
    `map.removePlugin("lens")`, settle → `[]`. Then `finishData(src)` → still `[]`, no throw.
- [ ] **Step 2: Run them.** `npx vitest run --project client tests/client/plugins/shapes-lens.test.ts`
  Expected: a, c, d fail (the set applies at once). b, e and f may pass. They are guards: break the
  code later to prove they can fail (Step 5).
- [ ] **Step 3: Implement.** In the hide effect, store `pending` and `queueMicrotask(tryApply)`.
  `tryApply` applies when the inner source is absent or `ctx.gl.isSourceLoaded(innerSource)`.
  `onData` calls `tryApply` only when `e.sourceId === innerSource && e.isSourceLoaded &&
  (e.tile || e.sourceDataType === "idle")`. `onError` (same `sourceId`) applies `pending`
  unconditionally. Register both with `ctx.gl.on` in setup. In teardown, `off` both, set
  `pending = null`, and keep `hooks.setHidden(new Set())`. `tryApply` does nothing after
  teardown (`ctxRef === null`).
- [ ] **Step 4: Run the client project.** `npm run test:client`. Expected: all pass, including
  the existing lens tests.
- [ ] **Step 5: Prove the guards.** Temporarily accept `metadata` in `onData` → b fails. Make
  `tryApply` always wait → e fails. Drop the teardown `off` → f fails. Revert each.
- [ ] **Step 6: Commit** after `npm run check`, `npm run lint`, `npm run test:bundle`:
  `git commit -m "Lens: hide the townships once the sections' tiles have loaded"`

### Task 2: Browser regression across recentres

**Files:**
- Test: `tests/browser/lens.browser.test.ts` (new `it`, its own map setup: `lensGrid` 7×7)

- [ ] **Step 1: Write the test** `"recentring never shows a township clear or under its sections
  for a frame"`. On each `render` event, for every township: read `getFeatureState(parents
  source).lensHidden` and `queryRenderedFeatures` at its centre for a `:lens:` layer. Record a
  frame when hidden without a section, or a section over one not hidden. Pin (3,3), wait 500 ms,
  start recording, pin (3,4), (4,4), (3,3) with 400 ms between, then `release()`. Expect `[]`.
  Place the view inside one tile: centre and zoom chosen so the 600×400 viewport lies within one
  z-floor tile (check with the slippy-tile formula), so MapLibre's per-tile swap can't flake it.
- [ ] **Step 2: Verify it fails on Task 1's parent commit** (`git stash` the Task 1 source
  change, or check out `src/lib/plugins/shapes-lens.svelte.ts` from `main`). Expected: 2
  mismatched frames per recentre and on release. Restore.
- [ ] **Step 3: Run it with the fix.** PASS. Then check it isn't flaky:
  `taskset -c 0,1 npx vitest run --project browser` 6 times, all green.
- [ ] **Step 4: Commit** `"Browser test: no mismatched lens frame across recentres"`.

### Task 3: Version and docs

**Files:**
- Modify: `package.json`, `package-lock.json` (`0.1.0-beta.21`), `README.md` (a new
  "### 0.1.0-beta.21" under "## Changes": the flash fix in both directions, with "hosts see no
  other change"; `GlMapLike.isSourceLoaded` for hosts that wrap the GL map), `CLAUDE.md`
  (the `shapesLens` line: "hides its parents once the sections' source has loaded
  (`sourcedata` tile/idle, `error`)" and `GlMapLike`'s new member).
- Check: `tests/unit/readme-examples.test.ts` needs no change (no example uses `GlMapLike`).

- [ ] **Step 1: Edit, then `npm run check && npm run lint && npm test`.** All green.
- [ ] **Step 2: Commit** `"0.1.0-beta.21: the lens hides its townships on load"`.
