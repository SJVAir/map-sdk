# Pesticide lens, shapes zoom range and cards, legend unit line and note, notice counts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@sjvair/map-sdk` `0.1.0-beta.17` with what the dashboard's pesticide Map needs: `zoomRange` and rich cards on `shapesPlugin`, a legend unit line and note, count markers on `pointsPlugin`, and `shapesLens` (townships that open into sections).

**Architecture:** The lens is its own plugin (`shapesLens`) that wraps an inner `shapesPlugin` for its children and drives a small reactive state machine (`lens-state.svelte.ts`) from new read-only `PluginContext` signals: each plugin's own hover hit (`hoverOf`), the map's `pinned`/`focusedKey`, and `pointerInCard`. The parents' `shapesPlugin` exposes internal hooks (by a module symbol) so the lens can hide parents through feature state and know whether they're in their zoom range. Everything is opt-in; untouched options keep today's behaviour.

**Tech Stack:** Svelte 5 runes, TypeScript, MapTiler SDK `~4.2.0` (MapLibre), Vitest (`unit`, `client`, `browser` projects), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-16-pesticide-lens-design.md` (read it with this plan; section numbers below are the spec's).

## Global Constraints

- Every new behaviour is opt-in: a host that sets none of the new options sees no change.
- Host content is a Svelte `Snippet` or plain already-translated text, never an HTML string.
- Colours from theme tokens only (shadcn names plus family tokens with fallbacks); `--highlight` never for text; no `.dark` assumption; type sizes are Tailwind `text-*`.
- No new `mapsdk_*` message keys are needed; if one is, it goes in `messages/en.json`, never a concatenated sentence.
- Colour never carries meaning alone; respect `prefers-reduced-motion` (the lens has no animation).
- Two maps share nothing; every source/layer id is `${mapUid}:${pluginId}:${local}`.
- Lens grace: **120 ms**. Swap zoom in tests and demo: **11** (townships `{ max: 11 }`, sections `{ min: 11 }`).
- Count markers: count 1 → plain dot; ≥ 2 → larger circle with the number; clusters sum it, same look, larger.
- `./data` and `./stores` stay off the map engine; run `npm run test:bundle` before each commit under `src/lib`.
- Code style: tabs, double quotes, no trailing commas, width 100; `npm run format`; runes only; never `Foo.svelte` + `foo.svelte.ts` in one folder; import rune modules as `./foo.svelte.js`.
- Specs live in `tests/**`; runes in fixtures only in `.svelte.ts`; never name a fixture prop `state`; key `{#each}` by id.
- Hover-sensitive browser test files call `tests/browser/park-pointer.ts` in `afterEach`.
- Each new test must be seen failing: run it before the code (or temporarily undo the code) and see the stated failure.
- No commits pushed and no PR opened without the user's yes.

## Review Focus

1. **The host replaces the lens source or the parents' data while the lens is up** (a bbox reload): the lens keeps its centre if that parent is still in the parents' data, drops (and releases) if it isn't, and parents' hidden state follows the new children. Test in Task 7.
2. **A basemap restyle while the lens is up** tears plugins down and sets them up again: the lens redraws, the parents' hidden feature state is reapplied, no timer from the old setup fires. Test in Task 7.
3. **`block()` names refKeys not in the parents' data, or `parentOf` returns null**: those children never draw and nothing throws. Test in Task 7.
4. **A pinned lens when the zoom leaves the parents' range**: dropped and released (`pinned` false), and the lens's list empties. Test in Task 6.
5. **Two maps, each with a lens, on one page**: hover on one never moves the other's lens. Test in Task 8.

---

### Task 1: Per-plugin hover, touch, and the card pointer in `PluginContext`

**Files:**
- Modify: `src/lib/core/interactions.svelte.ts` (`#lookup`, `#onMove`, `#onOut`, `#onPointerDown`)
- Modify: `src/lib/core/plugin.ts` (`PluginContext`)
- Modify: `src/lib/core/plugin-host.svelte.ts` (`#context`, host options)
- Modify: `src/lib/core/create-map.svelte.ts` (pass the new signals to `PluginHost`; `setPointerInCard`)
- Modify: `src/lib/ui/MapTooltip.svelte` (report pointer enter/leave on its root element)
- Test: `tests/client/core/interactions.test.ts`, `tests/client/core/plugin-host.test.ts`, `tests/browser/tooltip.browser.test.ts`

**Interfaces:**
- Produces (`plugin.ts`):
  ```ts
  export interface OwnHover extends Hovered { touch: boolean }
  // PluginContext additions, all read-only and reactive:
  hoverOf(pluginId: string): OwnHover | null;
  readonly pinned: Hovered | null;      // MapContext.pinned
  readonly focusedKey: string | null;   // MapContext.focusedKey
  readonly pointerInCard: boolean;
  ```
- Produces (router): `InteractionRouter.hoverOf(pluginId: string): OwnHover | null`. Computed in `#onMove` over **all** registrations (hoverable or not, blocking layers skipped as hits but not as "on top"): for each plugin, its topmost non-blocking hit under the point. Stored in a `SvelteMap<string, OwnHover>`, written only when a plugin's refKey or `touch` changes, cleared on `#onOut`, detach, and when the plugin unregisters. `touch` is `this.#lastPointerType === "touch"` at the move (the existing `pointerdown` record, kept until the next `pointerdown` instead of being cleared after a click — check the click path still reads it the same way).
- Produces (`MapContext`, `@internal`): `setPointerInCard(on: boolean): void` and `readonly pointerInCard: boolean`; `MapTooltip`'s root element sets it on `pointerenter`/`pointerleave`, and resets it on destroy.

- [ ] **Step 1: Failing tests (new behaviour)**
  - `interactions.test.ts`: `"hoverOf gives a plugin its own hit under another plugin's feature"` — register plugin `a` (layer `a-fill`) and `b` (layer `b-dot`), fake `queryRenderedFeatures` returns `[b-dot feature, a-fill feature]`; after a move, `router.hovered.hit.pluginId === "b"` and `router.hoverOf("a")?.hit.refKey` is a's refKey.
  - `"hoverOf sees through a blocking layer"` — top feature on a blocking registration; `hoverOf("a")` still gives a's hit.
  - `"hoverOf counts a non-hoverable plugin"` — `hoverable: false` registration: `router.hovered` is null, `hoverOf` gives its hit.
  - `"hoverOf is stable across moves within one feature"` — two moves over the same refKey: an `$effect` reading `hoverOf("a")` runs once (use `rootEffect`).
  - `"hoverOf marks touch"` — dispatch `pointerdown` with `pointerType: "touch"` on the fake canvas, then a move: `touch === true`; after a `pointerdown` with `"mouse"`, `false`.
  - `"hoverOf clears on mouseout and detach"`.
  - `plugin-host.test.ts`: `"a plugin context reads hoverOf, pinned, focusedKey and pointerInCard"`.
  - `tooltip.browser.test.ts`: `"pointerInCard is true while the pointer is over the pinned card"` (real pointer; park it after).
- [ ] **Step 2: Run them; expect failures** (`hoverOf is not a function`, undefined properties). `npx vitest run --project client tests/client/core` and `npx vitest run --project browser tests/browser/tooltip.browser.test.ts`.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run them, plus guards**: the whole `client` project and `tests/browser/tooltip.browser.test.ts` pass (existing hover, cursor and click tests are the guards: `map.hovered` is unchanged).
- [ ] **Step 5: `npm run check && npm run lint && npm run test:bundle`, then commit** `Core: a plugin's own hover, touch, and the card pointer`.

### Task 2: `zoomRange` on `shapesPlugin` (spec §1)

**Files:**
- Create: `src/lib/plugins/zoom-range.svelte.ts`
- Modify: `src/lib/plugins/points.svelte.ts` (use the helper; behaviour unchanged)
- Modify: `src/lib/plugins/shapes.svelte.ts`
- Test: `tests/client/plugins/shapes.test.ts`, `tests/browser/zoom-range-globe.browser.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ZoomRange { min?: number; max?: number }
  export function zoomRanged(range: ZoomRange | undefined): {
  	readonly ranged: boolean;
  	/** Reactive ($state): the camera zoom is inside the range (true when not ranged). */
  	readonly shown: boolean;
  	/** The spec with `layout.visibility` set from `shown` (unchanged when not ranged). */
  	zoomed(spec: LayerSpecWithoutId): LayerSpecWithoutId;
  	/** Listens on `zoom`, flips `shown`, sets visibility on `layerIds()`; returns the off. */
  	track(gl: GlMapLike, layerIds: () => string[], isDead: () => boolean): () => void;
  };
  ```
- `ShapesOptions.zoomRange?: ZoomRange`. With it set and out of range: `features()` returns `[]`, `legend()` returns `null`, layers hidden. Points keep listing and legending out of range.

- [ ] **Step 1: Failing tests** (`shapes.test.ts`, fake gl with a settable zoom and a `zoom` event):
  - `"zoomRange hides the layers out of range and shows them in range"` — layers built with `visibility: "none"` at zoom 12 for `{ max: 11 }`; after zoom to 10 and the event, `setLayoutProperty(…, "visibility", "visible")` on every layer.
  - `"out of its zoomRange, a shapes plugin lists nothing and has no legend"` — at zoom 12 `features()` is `[]` and `legend()` is `null`; at 10 both are back, and an `$effect` reading `features()` re-ran.
  - `"without zoomRange, shapes are unchanged"` — guard: no `visibility` in any layer layout.
- [ ] **Step 2: Run; expect** the first two to fail (visibility missing / items listed).
- [ ] **Step 3: Implement** `zoomRanged`; move points' inline zoom code onto it.
- [ ] **Step 4: Browser guard + new case**: add `"shapes ranges that meet leave no gap on a globe"` to `zoom-range-globe.browser.test.ts` beside the points case (a square polygon plugin `{ max: 11 }` and one `{ min: 11 }`; at 10.99 and 11.0 one is rendered). Run the file; run `tests/client/plugins/points.test.ts` (guard: points zoomRange unchanged).
- [ ] **Step 5: check, lint, test:bundle; commit** `Shapes: zoomRange, listed and legended only in range`.

### Task 3: Rich `tooltip` on `shapesPlugin` (spec §2)

**Files:**
- Modify: `src/lib/plugins/shapes.svelte.ts`, `src/lib/plugins/points.svelte.ts` (share the env type)
- Test: `tests/client/plugins/shapes.test.ts`, `tests/browser/tooltip.browser.test.ts`

**Interfaces:**
- Produces: `export interface ShapesTooltipEnv extends Providers { scale: Scale | null; precision: number }` — make `PointsTooltipEnv` an alias of one shared `TooltipEnv` (exported under both names).
- `ShapesOptions.tooltip?(item: FeatureListItem, props: P, env: ShapesTooltipEnv): Snippet | undefined;` and `tooltipShowsName?: boolean`. `props` looked up by refKey from `source.features`; providers captured in `setup` (as points does) and dropped on teardown.

- [ ] **Step 1: Failing tests:** `"shapes tooltip gets the item, its source props and the env"` (client: set up, call `plugin.tooltip!(item)`, the spy got `props.refKey === item.refKey` and `env.scale` the resolved scale); `"shapes tooltipShowsName sets the plugin flag"`; browser `"a shapes card shows the host's snippet with a working link"` (SnippetHost fixture; pin by click; the link is focusable inside the card).
- [ ] **Step 2: Run; expect** `plugin.tooltip` undefined.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; plus guard** `"shapes with no tooltip have no plugin.tooltip"`.
- [ ] **Step 5: check, lint, test:bundle; commit** `Shapes: a rich tooltip, as points have`.

### Task 4: Legend unit line and note (spec §3)

**Files:**
- Modify: `src/lib/core/plugin.ts` (`LegendData` scale variant: `unitsLine?: string; note?: Snippet`)
- Modify: `src/lib/plugins/scale-resolution.svelte.ts` or the plugins' `legend()` wrappers (attach the two)
- Modify: `src/lib/plugins/shapes.svelte.ts`, `src/lib/plugins/points.svelte.ts` (`legendUnits?: string`, `legendNote?: Snippet`)
- Modify: `src/lib/ui/legend-data.ts` (`LegendSection.unitsLine?`, `note?`; `shareSections` first-set rule)
- Modify: `src/lib/ui/Legend.svelte`
- Test: `tests/unit/ui/legend-data.test.ts`, `tests/client/plugins/shapes.test.ts`, `tests/browser/legend.browser.test.ts`

**Interfaces:**
- `legendSection` copies `unitsLine` and `note`; `shareSections` gives a shared section the first member's `unitsLine` that is set and the first member's `note` that is set.
- Legend markup per spec decision 6: with `unitsLine`, a `<p class="mapsdk-legend-units text-xs">` under the `h3`, coloured `var(--muted-foreground)`, and no "(units)" span; the note in a `<div class="mapsdk-legend-note text-xs">` after the "No data" row, rendering `{@render section.note()}`.

- [ ] **Step 1: Failing tests:** unit `"legendSection carries unitsLine and note"`, `"a shared section takes the first set unitsLine and note"`; client `"shapes legend carries legendUnits and legendNote"` and the same for points; browser `"a unit line replaces the (units) suffix"` (text "lbs per township" in `.mapsdk-legend-units`, no "(lbs)"), `"the note renders at the section's foot"` (after the No data row; a link inside is reachable), guard `"without a unit line the title keeps (units)"`.
- [ ] **Step 2: Run; expect** the new ones to fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three files; run `tests/unit/ui` and `tests/browser/legend.browser.test.ts` whole (guards).
- [ ] **Step 5: check, lint, test:bundle; commit** `Legend: a host unit line and note per section`.

### Task 5: `pointsPlugin({ count })` (spec §5)

**Files:**
- Modify: `src/lib/plugins/points.svelte.ts`, `src/lib/plugins/points-clusters.ts`
- Test: `tests/client/plugins/points.test.ts`

**Interfaces:**
- `PointsOptions.count?: { property: string }`. Throws at creation with `icon` set (`"map-sdk: count needs circle markers"`).
- Unclustered: the circle layer's `circle-radius` is `["case", [">=", ["get", property], 2], COUNT_RADIUS, DOT_RADIUS]` with `circle-stroke-color` `theme.background`, width 1.5; a symbol layer `count` filtered to `>= 2` with `text-field` `["to-string", ["get", property]]`, `text-color` `theme.background`, bold, size 11, allow-overlap. Starting sizes (the Explorer's): dot 7, count circle 11, cluster 15 (`DOT_RADIUS`, `COUNT_RADIUS`, `COUNT_CLUSTER_RADIUS`); the builder may tune them by eye in the demo.
- With `cluster`: `clusterProperties["mapsdk:count"] = ["+", ["get", property]]` merged with the host's; `countClusterLayers(args, property)` in `points-clusters.ts` gives the bubbles in the same look with `["get", "mapsdk:count"]`; a host `cluster.layers` still wins. Add `background` to `ThemeColors` if it isn't there (check `style.ts`; sentinel rule `#010203` applies).

- [ ] **Step 1: Failing tests:** `"count draws a dot for 1 and a numbered circle from 2"` (layer specs as above), `"count sums in clusters and labels the sum"` (source spec has `clusterProperties["mapsdk:count"]`; the cluster label layer reads it), `"a host cluster.layers wins over the count bubbles"`, `"count with icon throws"`, guard `"without count, circles and bubbles are unchanged"` (deep-equal today's specs).
- [ ] **Step 2: Run; expect** the four new ones to fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/client/plugins/points.test.ts` whole.
- [ ] **Step 5: check, lint, test:bundle; commit** `Points: count markers, summed in clusters`.

### Task 6: The parents' hooks in `shapesPlugin`

**Files:**
- Create: `src/lib/plugins/lens-hooks.ts`
- Modify: `src/lib/plugins/shapes.svelte.ts`
- Test: `tests/client/plugins/shapes.test.ts`

**Interfaces:**
- Produces (`lens-hooks.ts`, not exported from the package):
  ```ts
  export const LENS_PARENT: unique symbol;
  export interface LensParentHooks {
  	readonly choropleth: boolean;
  	/** Reactive: in its zoom range (true without one). */
  	readonly shown: boolean;
  	/** Reactive: the parents' refKeys in the latest data. */
  	readonly keys: ReadonlySet<string>;
  	/** Fill (and level outline) drawn transparent for these refKeys, by feature state `lensHidden`. */
  	setHidden(keys: ReadonlySet<string>): void;
  }
  export function lensParentOf(plugin: MapPlugin): LensParentHooks | null;
  ```
- `shapesPlugin` attaches the hooks under `LENS_PARENT`. Its fill-opacity expression gains an outer `["case", ["boolean", ["feature-state", "lensHidden"], false], 0, …]` **only after `setHidden` is first called with a non-empty set** (layers rebuilt once then), so plugins without a lens keep today's exact paint. Hidden keys are reapplied after a data reload and after setup on a restyle.

- [ ] **Step 1: Failing tests:** `"setHidden sets lensHidden feature state and clears it"`, `"hidden keys survive a data reload and a restyle"` (Review Focus 2), `"before any setHidden the fill paint is today's"` (guard, deep-equal), `"keys and shown are reactive"`; and for Review Focus 4 a later Task 7 test uses `shown`.
- [ ] **Step 2: Run; expect** `lensParentOf` null.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/client/plugins/shapes.test.ts` whole.
- [ ] **Step 5: check, lint, test:bundle; commit** `Shapes: internal hooks for a lens over them`.

### Task 7: `shapesLens` — the state machine and the plugin (spec §4)

**Files:**
- Create: `src/lib/plugins/lens-state.svelte.ts` (the rules, no GL)
- Create: `src/lib/plugins/shapes-lens.svelte.ts` (the plugin)
- Modify: `src/lib/index.ts` (export `shapesLens`, types `ShapesLens`, `ShapesLensOptions`, `ShapesTooltipEnv`)
- Test: `tests/client/plugins/lens-state.test.ts`, `tests/client/plugins/shapes-lens.test.ts`

**Interfaces:**
- `lens-state.svelte.ts`:
  ```ts
  export interface LensInputs {
  	parent(): OwnHover | null;    // ctx.hoverOf(parents.id)
  	child(): OwnHover | null;     // ctx.hoverOf(lens id)
  	childParent(refKey: string): string | null; // parentOf of a drawn child
  	inBlock(lngLat: [number, number]): boolean;  // inside a drawn child or a block parent
  	pinnedCard(): Hovered | null; focusedKey(): string | null;
  	pointerInCard(): boolean; inRange(): boolean; parentKeys(): ReadonlySet<string>;
  }
  export function createLensState(inputs: LensInputs, graceMs = 120): {
  	readonly center: string | null; readonly pinned: boolean; readonly held: boolean;
  	pin(refKey: string): void; release(): void; escape(): void;
  	/** Starts the effects; returns the teardown (clears timers). */
  	start(): () => void;
  };
  ```
  `held` = pinned, or a pinned card / focused item that is a drawn child or lies `inBlock`. Touch hovers are ignored. Esc (`escape()`) drops an unpinned lens and suppresses re-raise until the parent hover's refKey changes or goes null; on a pinned lens it releases.
- `shapes-lens.svelte.ts`: `export function shapesLens<C extends MapFeatureProperties>(options: ShapesLensOptions<C>): ShapesLens` (types exactly as spec §4). Inner `shapesPlugin({ id: options.id, source: blockSource, mode: "choropleth", layerLabel, fillOpacity, outline, noFigure, tooltip, tooltipShowsName, legendUnits, legendNote, listed: true })`, where `blockSource` is a derived `DataSource` whose `features` are only children with `parentOf` in `block(center)` (`null` collection while `center` is null), same `status` and `scale`. Its `setup` runs the inner setup with the lens's ctx, adds the centre outline layer (`center-outline`, 2px `theme.foreground`, filtered to the centre refKey on a copy of the parents' current features), calls `parents.setHidden` with the parents that have a drawn child, binds `keydown` Escape on `document` while the lens shows (so Esc works wherever focus is, WCAG 1.4.13; `defaultPrevented` events are skipped, and the card's own Esc still closes the card first), and starts the state. `features()` returns the inner items only while `pinned`; `legend()` the inner legend only while children are drawn; `summarizeEmpty = false`; `hoverPriority` unchanged. Throws `"map-sdk: shapesLens needs a choropleth shapesPlugin as parents"` otherwise.

- [ ] **Step 1: Failing tests — `lens-state.test.ts`** (`vi.useFakeTimers`, `$state` inputs from a `.svelte.ts` fixture, `flushSync`):
  - `"hovering a parent centres the lens"`; `"hovering a drawn child of a neighbour recentres"`; `"leaving both drops after 120 ms, not before"`; `"coming back within the grace keeps it"`; `"a recentre cancels a scheduled drop"`;
  - `"a parent under another plugin's marker keeps the lens"` (parent hover set while `map.hovered` is another plugin — the input is `parent()`, so assert it never drops);
  - `"the pointer in the card keeps the lens; leaving the card starts the grace"`;
  - `"touch hover never raises the lens"`;
  - `"Esc drops an unpinned lens until the parent hover changes"`;
  - `"pin centres and pins; hover doesn't move it; release unpins and drops"`;
  - `"a pinned card on a parent doesn't pin; on a drawn child it holds; closing it lets go"`;
  - `"a pinned lens is released when the pinned card closes or moves outside the block"`;
  - `"leaving the zoom range drops and releases"` (Review Focus 4);
  - `"the centre leaving the parents' data drops and releases"` (Review Focus 1);
  - `"teardown clears the timer"`.
- [ ] **Step 2: Run; expect** module-not-found, then each to fail on its assertion as the module grows.
- [ ] **Step 3: Implement `createLensState`.** Run `lens-state.test.ts` to green.
- [ ] **Step 4: Failing tests — `shapes-lens.test.ts`** (fake gl, a 3×3 + ring parent grid fixture with `mtrs`-like ids `T1-R1`…, children `T1-R1-S1`…, `block` = the 3×3 around, `parentOf` = strip the last `-Sn`):
  - `"only children of the block are drawn"` (a cached neighbour block in the source is filtered out);
  - `"a parent hides only once one of its children is drawn"`;
  - `"block names unknown parents and parentOf returns null: nothing draws, nothing throws"` (Review Focus 3);
  - `"the centre parent's outline is drawn over the children"`;
  - `"children are listed only while pinned, never selectable"`;
  - `"legend only while children are drawn; it shares a section with a sections plugin on the same ScaleRef"` (use `shareSections`);
  - `"tooltip goes to the lens's own tooltip option"`;
  - `"a restyle redraws the lens and re-hides parents; no old timer fires"` (Review Focus 2);
  - `"shapesLens throws for a plain or non-shapes parent"`.
- [ ] **Step 5: Run; expect** failures; **implement `shapesLens`**; run both files and the whole `client` project.
- [ ] **Step 6: check, lint, test:bundle; commit** `shapesLens: townships that open into sections`.

### Task 8: The lens in a real browser

**Files:**
- Create: `tests/browser/lens.browser.test.ts`, `tests/fixtures/lens-grid.ts` (shared grid: reused by the demo through a copy in `demo/`, not an import of `tests/`)
- Test only (fix code in `src/lib` if these find bugs)

- [ ] **Step 1: Write the tests** (real pointer through `page.mouse`/`userEvent`; `park-pointer` in `afterEach`; MapView with `card`; a points plugin of notices on top):
  - `"hover raises the lens; moving into a neighbour's section recentres; leaving drops it after the grace"`;
  - `"resting on a notice inside the lens keeps it"`;
  - `"moving from the lens onto the township's card keeps the lens"` (WCAG 1.4.13);
  - `"Esc drops a hover lens without moving the pointer"`;
  - `"a click on a township opens its card and doesn't pin the lens"`;
  - `"Show square miles pins it; Esc on the card closes the card and releases the lens"` (the card action calls `lens.pin`);
  - `"a touch tap opens the card only"` (dispatch `pointerdown` with `pointerType: "touch"` then the tap; the lens stays down);
  - `"two maps with lenses don't share one"` (Review Focus 5).
- [ ] **Step 2: Run each with the code under test temporarily undone** (e.g. return early in `hoverOf`), see it fail, restore.
- [ ] **Step 3: Flake check**: `taskset -c 0,1 npx vitest run --project browser` six times, all green.
- [ ] **Step 4: Commit** `Lens: browser tests with the real pointer`.

### Task 9: Measure 2500 sections (spec §6)

**Files:**
- Create: `tests/browser/shapes-perf.browser.test.ts` (kept, but `it.skipIf(!process.env.MAPSDK_PERF)`)
- Maybe modify: `src/lib/core/shape-view.ts`

- [ ] **Step 1:** A 50×50 grid of section squares around Fresno in one `shapesPlugin` on a real MapView; after `ready`, time 20 `jumpTo` moves, measuring `features()` plus `inView` per move with `performance.now()`. Report the median and the max (throw them from a temporary debug assertion if needed; browser specs don't show `console.log`).
- [ ] **Step 2:** Run with `MAPSDK_PERF=1`. If the median move costs over **16 ms**: write the failing guard `"inView skips the exact test when a bbox is wholly inside"` in `tests/unit/core` and implement the bbox-inside / label-point-inside shortcut in `shape-view.ts`; re-measure. Otherwise change nothing in `src/lib`.
- [ ] **Step 3:** Note the numbers for the coordinator (they decide the deferral). Commit `Perf: measure 2500 sections in view` (plus the shortcut if done).

### Task 10: The demo and e2e (spec §7)

**Files:**
- Create: `demo/pesticides.ts` (static grid of townships and sections in the Valley, section and township literal-scale `ScaleRef`s through the demo's metadata, notices with counts), `demo/PesticideCards.svelte` (township and section tooltip snippets, card actions)
- Modify: `demo/App.svelte` (a "Pesticide use" panel with its own map: `townships` `{ max: 11 }`, `lens`, `sections` `{ min: 11 }`, `notices` with `count` and `cluster`; legend unit lines and a note; expose `__mapsdkDemo.pesticides` and its lens)
- Modify: `e2e/demo.spec.ts`

- [ ] **Step 1: Failing e2e tests** (Chromium and Firefox locally: `npx playwright test --project chromium --project firefox`):
  - `"pesticide map: townships below 11, sections from 11"` (rendered layer ids via `__mapsdkDemo` and `queryRenderedFeatures`);
  - `"pesticide map: hover raises the lens and moving recentres it"` (`lens.center` changes);
  - `"pesticide map: Show square miles pins the lens; Esc releases it"`;
  - `"pesticide map: notice counts and the cluster sum"` (the count layer exists; a cluster feature's `mapsdk:count` equals the sum of its leaves — no drawn text, the e2e style has no glyphs);
  - the existing axe test covers the new panel (guard).
- [ ] **Step 2: Run; expect** failures (no panel).
- [ ] **Step 3: Build the panel.** No new `/api/` endpoints, so no new `e2e/fixtures/*.json`.
- [ ] **Step 4: Run** the whole e2e suite (Chromium, Firefox) and `npm run dev` to eyeball it; take one screenshot per basemap of the lens up and show the user in the visual companion.
- [ ] **Step 5: Commit** `Demo: a pesticide map with the lens and notice counts`.

### Task 11: Docs, version, full checks

**Files:**
- Modify: `README.md` (a pesticide-map section under "Plugins and draw order", `shapesLens` under "Writing a plugin" or its own section, "Changes" → `### 0.1.0-beta.17` listing every new key and API: `shapesPlugin` `zoomRange`/`tooltip`/`tooltipShowsName`/`legendUnits`/`legendNote`; `pointsPlugin` `count`/`legendUnits`/`legendNote`; `shapesLens` and its controls; `PluginContext.hoverOf`/`pinned`/`focusedKey`/`pointerInCard`; `LegendData.unitsLine`/`note`; `LegendSection.unitsLine`/`note`; token list unchanged unless Task 5 added one)
- Modify: `tests/unit/readme-examples.test.ts` (the new examples type-check)
- Modify: `CLAUDE.md` (architecture lines: shapes, points, the lens, `PluginContext`, legend)
- Modify: `package.json` version → `0.1.0-beta.17` (and the lockfile's)

- [ ] **Step 1:** Write the docs; `npm run check` (the README examples spec) must pass.
- [ ] **Step 2: Full run:** `npm run lint && npm run check && npm test && npm run test:bundle && npm run test:licenses && npx playwright test --project chromium --project firefox`. All green; report any failure with its output.
- [ ] **Step 3: Commit** `0.1.0-beta.17: README, CLAUDE.md and version`.
- [ ] **Step 4:** Fresh whole-branch review on the most capable model (superpowers:requesting-code-review); bring all findings, minors included, to the user with proposed fixes.
- [ ] **Step 5:** Ask the user before pushing and opening the PR; the merge (after CI on the last commit) and the release are each their own yes.
