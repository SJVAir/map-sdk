# MapView `layoutRoot` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `MapView` takes a `layoutRoot` element whose width decides the options toolbar's
wide/narrow layout, so monitor-map's toolbar stays wide when its detail panel shrinks the map.

**Architecture:** `MapView.svelte` already turns its own `clientWidth` into `layoutWidth` a frame
later and derives `wide` from `isWideWidth(layoutWidth)`. When `layoutRoot` is set, a
`ResizeObserver` on it supplies that width instead. Everything else (`box()`, the bar's height,
`--mapsdk-map-width`) keeps reading the map's own box.

**Tech Stack:** Svelte 5 runes, Vitest browser mode (Chromium), vitest-browser-svelte.

**Spec:** `docs/superpowers/specs/2026-11-13-layout-root-design.md`

## Global Constraints

- Opt-in: a `MapView` with no `layoutRoot` (or `null`) behaves exactly as in `0.1.0-beta.13`.
- Only the wide/narrow decision moves: dropdowns and the narrow panel use `MapLayout.box()` (the
  map's box), and `--mapsdk-toolbar-height` and `--mapsdk-map-width` are unchanged.
- The layout follows the measured width a frame later (`requestAnimationFrame`), never inside the
  ResizeObserver callback; the threshold is `isWideWidth` (48rem).
- Nothing module-global; never read a prop in an effect's cleanup (capture it in the effect).
- Tabs, double quotes, no trailing commas, width 100; `npm run format`; `npm run test:bundle` before
  committing `src/lib` changes. No AI attribution in commits.

## Review Focus

1. The root unmounting before the map (`bind:this` going null), which should drop back to the
   map's own width with no error and no observer left on the detached element. Pinned in Task 1's
   "null root" test.
2. A root swapped for another element, where the observer should move to the new one. Pinned in
   Task 1's "swapped root" test.
3. Resizing the root across 48rem, which should raise no ResizeObserver loop error (as part 5's
   `crossing to narrow and back` test checks for the map). Pinned in Task 1's "root crossing" test.
4. A root that measures 0 wide (`display: none`), which should count as wide, like today's
   unmeasured map. Pinned in Task 1's "zero-width root" test.
5. Two maps under one root deciding on their own: covered by the design (each prop is separate,
   with no shared state). No test is needed beyond Task 1's.

---

### Task 1: `layoutRoot` measures the switch

**Files:**
- Create: `tests/fixtures/MapViewInRoot.svelte`
- Modify: `src/lib/view/MapView.svelte` (Props, the `layoutWidth` effect near line 262)
- Test: `tests/browser/options-toolbar-layout.browser.test.ts` (new `describe("layoutRoot")`)

**Interfaces:**
- Produces: `MapView` prop `layoutRoot?: HTMLElement | null`, with the JSDoc "The element whose
  width decides the toolbar's wide/narrow layout (48rem), such as a box holding the map and a side
  panel. Unset or null: the map's own box. Dropdowns and the narrow panel stay inside the map."
- Fixture `MapViewInRoot.svelte` props:
  `{ map: MapContext; state: ToolbarState; rootClass?: string; mapClass?: string; useRoot?: boolean }`.
  It renders `<div bind:this={shell} class={rootClass} style="display: flex">` holding
  `<MapView {map} class={mapClass} layoutRoot={useRoot ? shell : null} toolbar={…}>` (the same
  toolbar snippet as `MapViewWithToolbar.svelte`) plus a sibling `<div style="flex: 1">` as the
  panel. Defaults: `rootClass = "root-1024"`, `mapClass = "map-683"`, `useRoot = true`.
- Add to the test file's `sized` styles: `.root-1024 { width: 1024px; height: 500px; }`,
  `.root-600 { width: 600px; height: 400px; }`, `.map-683 { width: 683px; height: 500px; flex: none; }`,
  `.map-600 { width: 600px; height: 400px; flex: none; }`.

- [ ] **Step 1: Write the failing tests** (each renders the fixture, then `await settle()`)

```ts
describe("layoutRoot", () => {
	it("a 1024px root keeps a 683px map's toolbar wide", async () => {
		// expect trigger("Monitors") visible; "Open map options" button absent
	});
	it("without it, the same 683px map goes narrow, as before", async () => {
		// useRoot: false → "Open map options" visible, trigger("Monitors") null
	});
	it("a root under 48rem goes narrow (phones: the panel stacks under the map)", async () => {
		// rootClass "root-600", mapClass "map-600" → "Open map options" visible
	});
	it("null root: back to the map's own box", async () => {
		// render wide with the root; screen.rerender({ useRoot: false }); settle → narrow
	});
	it("follows the root's resize, not the map's", async () => {
		// set shell's style.width = "600px" → narrow after settle; back to "1024px" → wide
		// (the map's 683px never changes)
	});
	it("swapped root: follows the new element", async () => {
		// rerender({ altRoot: true }) → narrow; rerender({ altRoot: false }) → wide
	});
	it("root crossing 48rem raises no ResizeObserver loop error", async () => {
		// listen for window "error" events matching /ResizeObserver loop/, as the existing
		// "crossing to narrow and back" test does; resize the root 1024 → 600 → 1024; expect none
	});
	it("a zero-width root counts as wide", async () => {
		// set the root to width 0 while keeping the map 683px (overflow visible) → trigger("Monitors") visible
	});
	it("an open dropdown stays inside the 683px map", async () => {
		// open trigger("Settings") (align end) and trigger("Monitors"); each dropdown body's
		// getBoundingClientRect() left >= map left and right <= map right (the map is .mapsdk-map)
	});
});
```

For the swap, the fixture also takes `altRoot?: boolean` (default false). When it's set, it passes
a second element, a `<div class="root-600">` placed beside the shell, instead of `shell`.

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run --project browser tests/browser/options-toolbar-layout.browser.test.ts -t layoutRoot`
Expected: "keeps … wide", "follows the root's resize", "swapped root", "zero-width" and "dropdown stays inside" FAIL (the
toolbar is narrow); "without it", "under 48rem" and "null root" may already pass.

- [ ] **Step 3: Implement it in `MapView.svelte`**

Add the prop. Keep `width` from `bind:clientWidth`. Add `let rootWidth = $state(0)` and an
effect that captures `const el = layoutRoot` and, when `el` is set, observes it with a
`ResizeObserver`, setting `rootWidth = el.clientWidth`, also once at the start. On cleanup it
disconnects and sets `rootWidth = 0`. The existing `layoutWidth` effect reads
`const w = layoutRoot ? rootWidth : width`. Leave `wide = layoutWidth === 0 || isWideWidth(…)`
unchanged, so a zero-width root is wide.

- [ ] **Step 4: Run the tests and check they pass**

Run: the Step 2 command, then the whole `npx vitest run --project browser tests/browser/options-toolbar-layout.browser.test.ts`
Expected: everything passes, the existing tests unchanged.

- [ ] **Step 5: Run the full checks and commit**

Run: `npm run format && npm run check && npm run lint && npm test && npm run test:bundle`
Expected: all pass.

```bash
git add src/lib/view/MapView.svelte tests/fixtures/MapViewInRoot.svelte tests/browser/options-toolbar-layout.browser.test.ts
git commit -m "MapView: layoutRoot, the box the toolbar's wide/narrow switch measures"
```

### Task 2: Docs, examples test, version

**Files:**
- Modify: `README.md` ("The options toolbar", near line 357; "Changes", near line 787)
- Modify: `tests/unit/readme-examples.test.ts`
- Modify: `CLAUDE.md` (the **View** line), `package.json` and `package-lock.json` (version)

**Interfaces:**
- Consumes: Task 1's `layoutRoot` prop.

- [ ] **Step 1: Write the failing examples test**

```ts
it("MapView's layoutRoot, as monitor-map's shell uses it", () => {
	const props: Pick<ComponentProps<typeof MapView>, "layoutRoot"> = { layoutRoot: null };
	expect(props.layoutRoot).toBeNull();
});
```

Import `MapView` the way the README does, if it isn't imported already. Then run `npm run check`.
Expected: it passes after Task 1, since the type exists. This test guards the README's name.

- [ ] **Step 2: Update the README**

In "The options toolbar", change "(the map's box, not the window)" to "(the map's box, or the
`layoutRoot` you pass)". Then add a paragraph: `layoutRoot` takes an element, usually a box
holding the map and a side panel, whose width decides wide or narrow instead of the map's.
Dropdowns and the panel still stay inside the map. With a null root, the map measures itself.
Include an example:

```svelte
<div bind:this={shell} class="flex">
	<MapView {map} layoutRoot={shell}>…</MapView>
	<aside class="w-1/3">…</aside>
</div>
```

Add a `### 0.1.0-beta.14` heading above beta.13 in "Changes": "**`MapView`'s `layoutRoot`:** the
toolbar's wide/narrow switch can measure a box larger than the map (monitor-map's map plus its
detail panel). Hosts that pass nothing see no change."

- [ ] **Step 3: Update CLAUDE.md and the version**

In the View line, after `the narrow panel makes the map's other children inert`, add: "`layoutRoot`
(an element) makes the wide/narrow switch measure that box instead of the map's". Run
`npm version 0.1.0-beta.14 --no-git-tag-version`.

- [ ] **Step 4: Run the checks and commit**

Run: `npm run format && npm run check && npm run lint && npm run test:unit`
Expected: pass.

```bash
git add README.md CLAUDE.md package.json package-lock.json tests/unit/readme-examples.test.ts docs/superpowers
git commit -m "0.1.0-beta.14: MapView's layoutRoot"
```
