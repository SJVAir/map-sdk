# The options toolbar (part 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared options toolbar that looks, reads and behaves like monitor-map 5.0's. It has wide and narrow layouts chosen by the map's width. The host owns the values, and presets declare the rows. Part 5 also brings 17 basemaps with a Theme row, a note slot in the feature list, and three fixes: a modifier pick that doesn't pin, a view summary that follows the data, and the child-care contrast. It ships as `@sjvair/map-sdk` `0.1.0-beta.13`.

**Architecture:**
- **A new `src/lib/options/` folder:**
  - plain-data declarations (`types.ts`);
  - pure value logic (`values.ts`: group state, select-all, reset, change events);
  - the `OptionsToolbar` component and its row components.
- **`MapView` places the toolbar.** It takes a `toolbar` snippet, renders it in a top-left slot, and measures that slot, so the List button stacks below it and hosts get `--mapsdk-toolbar-height`. It also provides the map's width to the toolbar through context, which picks the layout from that width (48rem).
- **The presets are functions of the map:** `basemapOptions(map)`, `hmsOptions(map)`, `schoolsOptions(map)` and `monitorsOptions(map)`. Each returns groups and defaults and takes its labels from message keys and the `MetadataProvider`. None of them wire values to plugins; the host does.
- **Basemaps:** `BasemapConfig` styles gain names, grouping and their own excluded layers. `BasemapState` gains id resolution and a fallback event.

**Tech Stack:** Svelte 5 runes, TypeScript, MapTiler SDK 4.2, Vitest (unit, client, browser), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-options-toolbar-and-widget-needs-design.md`, section "5. The options toolbar", including "Decided in part 5's brainstorm (2026-11-12)" (e226b82). Read it with this plan. The reference implementation is monitor-map's `src/lib/options/` on `release/5.0.0` (`git -C ../monitor-map show origin/release/5.0.0:src/lib/options/<file>`).

## Global Constraints

- **Opt-in.** A host that changes nothing gets `0.1.0-beta.12`'s map. The only exceptions are the three fixes, and that `map.basemap.select` accepts (and resolves) more ids.
- **Monitor-map's look, icons and words, exactly.** The spec's list: 40px triggers, `text-sm font-medium`, a 16px inset, `min-w-64` dropdowns, joined clusters with dividers, `rounded-md`, `shadow` / `shadow-lg`. Lucide icons and their tints are the host's, passed as snippets. map-sdk adds no icon dependency except the chevron, the sliders and the close glyphs, which it draws inline from Lucide's paths with Lucide's ISC notice, as `school-icons.ts` does.
- **Surfaces use theme tokens** (`--popover`, `--popover-foreground`, `--border`, `--accent`, `--muted-foreground`, `--ring`, with fallbacks), never fixed grays.
- **Breakpoint:** wide when the map's box is at least `48rem` wide (computed from the root font size), narrow below. Crossing it closes everything.
- **Values:** `type OptionValues = Record<string, boolean | string>`. `onchange(values, changed)` fires once per user action with the whole new object. Setting `values` from the host never fires it.
- **The basemap is one key** holding the variant id. A switch of basemap lands on that basemap's default variant.
- **Every new UI string is a `mapsdk_options_*` key** in `en.json`, with the English text from the spec: "Open map options", "Close map options", "Map Options", "Monitors", "Layers", "Overlays", "Settings", "Reference-grade", "Low-cost sensors", "Inactive", "Inside", "Collocation Sites", "Fire & Smoke", "Marker Clusters", "Basemap", "Theme", "Reset Map Options", "None", plus "Schools & Child Care" (my call) and `mapsdk_options_toolbar_label` "Map options".
- **Per-instance ids** come from `$props.id()`. Nothing is module-global. Two toolbars never share an open menu.
- **Disclosure pattern:** `aria-expanded` and `aria-controls` triggers, and native checkbox, radio and select inputs. Read-only uses `aria-disabled`, never `disabled`, and the triggers still open.
- **Reduced motion:** the panel slides in only under `prefers-reduced-motion: no-preference`.
- **Code style:** tabs, double quotes, no trailing commas, width 100, runes only. Don't give a component and a `.svelte.ts` module the same base name in one folder. Key `{#each}` blocks by id or position.
- **Before each commit under `src/lib`:** `npm run lint && npm run check && npm test && npm run test:bundle`. Also run `npm run test:licenses` after Task 5, for the inline Lucide paths.
- **No Claude or AI attribution.** Pushing, opening the PR, merging and the release each need the user's yes.

## Review Focus

1. **A dropdown that closes on focus-out, as its row is removed.** Chrome fires `focusout` while the node is still attached. Example: a monitor type row vanishes when the pollutant changes while it's focused. The dropdown must not close or throw, and focus goes to the trigger. Pinned in Task 5.
2. **A tile shorter than its dropdown, or a trigger near the right edge.** The dropdown stays inside the map, scrolls, and aligns to whichever edge keeps it inside. Pinned in Task 6.
3. **The host replaces `groups` while a menu is open** (labels resolving, rows appearing). The open menu stays open and focus stays on its row. Pinned in Task 5.
4. **A saved basemap id from an older MapTiler version** (`streets-v2-dark`) resolves to `streets-v4`, and the toolbar sends one change event. A garbage id resolves to the default. Never a blank map. Pinned in Task 3 and Task 7.
5. **Two maps on one page:** Esc, outside clicks and hover in one toolbar leave the other's menus alone, and ids never collide. Pinned in Task 6.

---

### Task 0: Plan

- [ ] Branch `feat/options-toolbar` exists (it holds the spec revision, e226b82). Commit this plan: `git add docs/superpowers/plans/2026-11-12-options-toolbar.md && git commit -m "Plan: the options toolbar"`

### Task 1: A modifier pick marks without pinning

**Files:**
- Modify: `src/lib/core/create-map.svelte.ts` (`#pick`, ~line 780)
- Test: `tests/client/core/interactions.test.ts` (the `modSetUp` block, ~line 1060)

- [ ] **Step 1: Write the failing tests** beside "modifier mode: Shift-click toggles in multiple mode":
  - `"modifier mode: Shift-click marks without pinning the card"`: `clickOn("a", { shiftKey: true })`, then expect `ids(map)` to be `["a"]` and `map.pinned` to be `null`.
  - `"modifier mode: Shift-click keeps an already pinned card as it is"`: `clickOn("b")` (pins b), then `clickOn("a", { shiftKey: true })`. Expect `map.pinned?.hit.refKey` to be `"monitor:b"` and `ids(map)` to be `["a"]`.
  - Keep the existing "a plain click pins" and "a touch tap only pins" tests unchanged.
- [ ] **Step 2:** `npx vitest run --project client tests/client/core/interactions.test.ts`. Expected: both new tests FAIL (pinned is `monitor:a`).
- [ ] **Step 3: Implement.** In `#pick`, after `#applyPick`, return before pinning when the plugin's `pickWith` is `"modifier"` and `e.modifier` is true. Read `pickWith` untracked, as on the box-zoom line.
- [ ] **Step 4:** run the same command; all pass. Then run `npm test`.
- [ ] **Step 5: Commit:** `git commit -m "A modifier pick marks without pinning the card"`

### Task 2: The spoken view summary follows the data

**Files:**
- Modify: `src/lib/ui/ViewSummary.svelte`
- Test: `tests/client/ui/view-summary.test.ts` (create; mount `ViewSummary` with `tests/client/environment.ts`'s client compile, or drive its `$effect` with `rootEffect` from `tests/fixtures/effects.svelte.ts`. Use `TestSource` from `tests/fixtures/sources.svelte.ts`.)

- [ ] **Step 1: Write the failing tests.** Each uses fake timers: advance by `SUMMARY_DEBOUNCE_MS`, then read the lines.
  - `"re-counts when a plugin's features change at a still view"`: start with 2 monitors in view, then set `source.features` to 3. Expect the `view:monitors` line to read the 3-monitor text from `summaryText`.
  - `"re-counts when a plugin is added or removed at a still view"`: `map.addPlugin(second)` adds a `view:second` line; `map.removePlugin("second")` drops it.
  - `"keeps an unchanged line's text and key when another plugin's data changes"`: the monitors line keeps the same element (same key, same text) while a smoke source changes.
  - `"still debounces"`: two feature changes within `SUMMARY_DEBOUNCE_MS` produce one update.
- [ ] **Step 2:** `npx vitest run --project client tests/client/ui/view-summary.test.ts`. Expected: the first two FAIL.
- [ ] **Step 3: Implement.** Add a `$derived` signature that reads each plugin's `features?.()` (array identity and length, joined by plugin id) and `map.plugins` ids. Make the effect depend on it, like `selectionCounts`. `compute` stays untracked. Don't change `summaryText`.
- [ ] **Step 4:** run it, then `npm test`.
- [ ] **Step 5: Commit:** `git commit -m "The spoken view summary re-counts when a plugin's data changes"`

### Task 3: Basemaps: the full list, names, resolution and the fallback event

**Files:**
- Modify: `src/lib/core/basemap.svelte.ts`, `src/lib/view/create-gl-map.ts` (`defaultBasemaps`), `src/lib/index.ts` (export `BasemapStyle`)
- Test: `tests/client/core/basemap.test.ts`, `tests/browser/map-view.browser.test.ts` (`describe("defaultBasemaps")`)

**Interfaces:**
- Produces:
  ```ts
  export interface BasemapStyle {
  	id: string;
  	style: unknown;
  	/** The basemap's display name ("Streets"); variants of one basemap share it. */
  	basemap?: string;
  	/** The variant's display name ("Dark"). */
  	name?: string;
  	/** This basemap's default variant. */
  	isDefault?: boolean;
  	/** Layers removed from this style; falls back to the config's `excludedLayers`. */
  	excludedLayers?: string[];
  }
  export interface BasemapConfig {
  	styles: BasemapStyle[];
  	defaultId: string;
  	excludedLayers?: string[];
  }
  // BasemapState gains:
  /** The configured styles (read-only), for building rows. */
  get styles(): readonly BasemapStyle[];
  /** `id` if listed; else its basemap's default variant (matched by the id without `-v<n>…`); else `defaultId`. */
  resolve(id: string): string;
  /** Calls `handler(id)` when a failed style made `current` revert, or `select` resolved an unlisted id. Returns an unsubscribe. */
  onFallback(handler: (id: string) => void): () => void;
  ```
- `select(id)` now selects `resolve(id)` instead of ignoring an unknown id.

- [ ] **Step 1: Write the failing tests** in `basemap.test.ts`. Replace "ignores unknown ids" with:
  - `"resolves an unlisted id of a listed basemap to its default variant and reports it"`: the config has `streets-v4`, `streets-v4-dark` (with `basemap: "Streets"`) and `outdoor-v2`. `select("streets-v2-dark")` makes `current` `"streets-v4"` and calls `onFallback` once with `"streets-v4"`.
  - `"resolves an id of no listed basemap to the default"`: `select("nope")` gives `defaultId`, reported once.
  - `"reports a load failure's revert once"`: the existing revert test, plus an `onFallback` spy called once with the reverted id.
  - `"a listed id never reports"`.
  - `"removes a style's own excludedLayers, else the config's"`.
  - `"onFallback's unsubscribe stops reports"`.
- [ ] **Step 2: Write the failing browser test** in `describe("defaultBasemaps")`:
  - 17 distinct basemap names, sorted;
  - each name has exactly one `isDefault` variant;
  - `defaultId` is `"streets-v4"`;
  - only the `streets-v4*` styles carry the six POI `excludedLayers` (`Sport`, `Tourism`, `Culture`, `Shopping`, `Food`, `Transport`), and the config-wide list is absent;
  - every style is a URL string;
  - building the list logs no console warning (spy on `console.warn`; MapTiler warns on deprecated styles).
- [ ] **Step 3:** run `npx vitest run --project client tests/client/core/basemap.test.ts` and `npx vitest run --project browser tests/browser/map-view.browser.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - `defaultBasemaps()` uses monitor-map's newest-version filter over `MapStyle` (copy `BASEMAP_STYLES` from monitor-map's `src/lib/map/basemaps.ts`), with each variant's `getName()`, the style's `getName()` and `isDefault` from `getDefaultVariant()`. If the filter's getters warn, filter by key before reading the values.
  - `resolve` strips `/-v\d+(?=-|$)/` and what follows the version to get the basemap stem. It matches a listed id with the same stem and `isDefault`.
  - `#recover` and `select` call the handlers. Keep them in a per-instance `Set`, each call wrapped in `try`, logging `map-sdk:` errors like the featureclick handlers.
- [ ] **Step 5:** run both commands, then `npm test && npm run test:bundle`.
- [ ] **Step 6: Commit:** `git commit -m "Basemaps: every MapTiler style, names and grouping, id resolution and a fallback event"`

### Task 4: Option declarations and the value logic

**Files:**
- Create: `src/lib/options/types.ts`, `src/lib/options/values.ts`
- Test: `tests/unit/options/values.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  import type { Snippet } from "svelte";
  export type OptionValues = Record<string, boolean | string>;
  /** A Lucide (or any) icon snippet, or SVG markup such as `circle(...)`. */
  export type OptionIcon = Snippet | { svg: string };
  export interface OptionChoice {
  	value: string;
  	label: string;
  	unit?: string;
  	help?: string;
  	icon?: OptionIcon;
  	/** Other values this choice also shows as chosen (a select's basemap for each of its variants). */
  	matches?: string[];
  }
  export type OptionRow =
  	| { kind: "checkbox"; id: string; label: string; icon?: OptionIcon; children?: OptionRow[] }
  	| { kind: "group"; id: string; label: string; icon?: OptionIcon; children: OptionCheckbox[] }
  	| { kind: "radio"; id: string; label?: string; icon?: OptionIcon; choices: OptionChoice[]; closesMenu?: boolean }
  	| { kind: "select"; id: string; label: string; icon?: OptionIcon; choices: OptionChoice[] }
  	| { kind: "action"; id: string; label: string; icon?: OptionIcon; onclick: () => void }
  	| { kind: "reset"; id: string; label: string; icon?: OptionIcon }
  	| { kind: "separator"; id: string };
  export type OptionCheckbox = Extract<OptionRow, { kind: "checkbox" }>;
  export interface OptionGroup {
  	id: string;
  	label: string;
  	icon?: OptionIcon;
  	/** Wide toolbar shows the icon alone (the panel still shows the label). */
  	iconOnly?: boolean;
  	align?: "start" | "end";
  	disabled?: boolean;
  	/** Groups with the same `cluster` join into one button row, in order. */
  	cluster?: string;
  	rows: OptionRow[];
  }
  /** What a preset returns. */
  export interface OptionsPreset { groups: OptionGroup[]; defaults: OptionValues }
  ```
- Produces (`values.ts`):
  ```ts
  export type GroupStatus = "checked" | "unchecked" | "indeterminate" | "empty";
  export function groupStatus(row: Extract<OptionRow, { kind: "group" }>, values: OptionValues): GroupStatus;
  /** One action's result: the next values and the keys that changed (empty = no event). */
  export function applyGroup(row, values, on: boolean): { values: OptionValues; changed: string[] };
  export function applyValue(id: string, value: boolean | string, values: OptionValues): { values: OptionValues; changed: string[] };
  export function applyReset(defaults: OptionValues, values: OptionValues): { values: OptionValues; changed: string[] };
  export function choiceFor(row: { choices: OptionChoice[] }, value: unknown): OptionChoice | undefined;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `groupStatus`: all children true → `"checked"`; mixed → `"indeterminate"`; no children → `"empty"`.
  - `applyGroup`: on an indeterminate group, turning it on sets only the listed children, and `changed` lists only the children that flipped. Values outside the group are untouched.
  - `applyValue` with an equal value gives `changed: []`.
  - `applyReset` returns `defaults` merged over `values` (keys not in `defaults` are kept), and `changed` is the differing keys.
  - `choiceFor` finds a choice by `value`, then by `matches`.
  - Every result is a new object; the input is never mutated.
- [ ] **Step 2:** `npx vitest run --project unit tests/unit/options/values.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the two files. They have no Svelte imports besides `Snippet`'s type.
- [ ] **Step 4:** run it, then `npm run check`.
- [ ] **Step 5: Commit:** `git commit -m "Options: declarations and value logic"`

### Task 5: `OptionsToolbar`, wide layout, rows and read-only

**Files:**
- Create: `src/lib/options/OptionsToolbar.svelte`, `src/lib/options/OptionsMenu.svelte`, `src/lib/options/rows/{CheckboxRow,GroupRow,RadioRow,SelectRow,ActionRow}.svelte`, `src/lib/options/OptionIcon.svelte`, `src/lib/options/glyphs.ts` (inline Lucide `chevron-down`, `sliders-horizontal` and `x` paths, with the ISC notice), `src/lib/options/menus.svelte.ts` (per-toolbar open-menu state)
- Modify: `src/lib/data/messages/en.json` (every `mapsdk_options_*` key from Global Constraints), `src/lib/index.ts` (export `OptionsToolbar` and the types from `types.ts`)
- Test: `tests/browser/options-toolbar.browser.test.ts`, `tests/fixtures/OptionsToolbarHost.svelte`

**Interfaces:**
- Produces (`OptionsToolbar` props):
  ```ts
  interface Props {
  	groups: OptionGroup[];
  	values: OptionValues;
  	onchange: (values: OptionValues, changed: string[]) => void;
  	/** Enables `reset` rows; what they reset to. */
  	defaults?: OptionValues;
  	readonly?: boolean;
  	/** Last on the wide toolbar, beside the options button on the narrow one. */
  	search?: Snippet;
  	/** The key of a basemap row: map-sdk's fallbacks are sent as changes to it (Task 7). */
  	basemapKey?: string;
  }
  ```
  It reads `getMapContext()` and, from Task 6, the layout from `MapView`. In this task, treat the layout as wide whenever there's no `MapView` context.

- [ ] **Step 1: Write the failing browser tests.** Mount through `OptionsToolbarHost`, which holds `values` in `$state` and records `onchange` calls.
  - `"triggers are disclosure buttons"`: `aria-expanded` and `aria-controls`; the toolbar is a `role="toolbar"`-free group labelled `mapsdk_options_toolbar_label`.
  - `"one dropdown open at a time; click toggles"`.
  - `"hovering another trigger with a mouse closes a click-opened dropdown; touch hover does nothing"`.
  - `"outside click, focus leaving, and Esc close; Esc returns focus to the trigger"`.
  - `"picking a radio with closesMenu closes the dropdown"`.
  - `"a select-all on an indeterminate group is one onchange with every flipped child"`.
  - `"a checkbox's children show only while it is on or partly on"`.
  - `"reset is one onchange to defaults; no reset row without defaults"`.
  - `"setting values from the host fires nothing and updates the inputs"`.
  - `"read-only: rows focusable with aria-disabled, triggers open, nothing fires"`.
  - `"replacing groups keeps the open menu open and focus on its row"` (Review Focus 3).
  - `"a focused row removed by new groups hands focus to its trigger without closing or throwing"` (Review Focus 1; the microtask flag, as in `MapTooltip`).
  - `"a disabled group's trigger is disabled and dims"`.
  - `"iconOnly shows the label to screen readers only"`.
  - `"align end anchors to the trigger's right edge"`.
  - `"axe: no violations on the open toolbar"` (run on the toolbar's root).
- [ ] **Step 2:** `npx vitest run --project browser tests/browser/options-toolbar.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Port monitor-map's `OptionsBar`, `OptionsMenu`, `OptionsGroup` and rows to the declarations. Every change goes through `values.ts`, then `onchange`.
  - Hover opens only when `pointerType === "mouse"` and the layout is wide.
  - The rows' markup copies monitor-map's classes, with grays replaced by tokens.
- [ ] **Step 4:** run it, then `npm test && npm run test:bundle && npm run test:licenses`.
- [ ] **Step 5: Commit:** `git commit -m "OptionsToolbar: the wide layout, every row kind, read-only"`

### Task 6: Narrow layout, `MapView` placement, staying inside the map

**Files:**
- Modify: `src/lib/view/MapView.svelte` (a `toolbar?: Snippet` prop; a top-left `.mapsdk-toolbar-slot` above the list in z-order; `extent()` counts the slot for the `top-left` corner; sets `--mapsdk-toolbar-height` on the root; provides a layout context `{ get wide(): boolean; get width(): number; get height(): number }` from the `width` it already measures), `src/lib/options/OptionsToolbar.svelte`
- Create: `src/lib/view/map-layout.ts` (the context key and its getter `getMapLayout()`)
- Test: `tests/browser/options-toolbar.browser.test.ts`, `tests/browser/list-position.browser.test.ts`, `tests/fixtures/MapViewWithToolbar.svelte`

- [ ] **Step 1: Write the failing browser tests:**
  - `"a 300px map gets the options button and a Map Options panel; a 1000px map gets the row"`: the window stays wide in both cases.
  - `"the panel: close button, several sections open, a radio keeps its section open, Esc closes"`.
  - `"crossing 48rem closes everything"`: resize the map's container.
  - `"a dropdown taller than the space below its trigger is capped inside the map and scrolls"` (Review Focus 2).
  - `"an align-start dropdown that would overflow the map's right edge aligns end"` (Review Focus 2).
  - `"the panel sits above the list, legend and card"`: compare stacking with `elementFromPoint`.
  - `"the List button (reveal focus, top-left) shows below the toolbar when tabbed to"`.
  - `"--mapsdk-toolbar-height is the slot's bottom in px, 0 without a toolbar"`.
  - `"no toolbar snippet: MapView renders as before"`: the slot is absent and the list position is unchanged.
  - `"two maps: Esc and outside clicks in one leave the other's open menu alone; ids differ"` (Review Focus 5).
  - `"reduced motion: no transition on the panel"`.
  - `"axe on both layouts"`.
- [ ] **Step 2:** run the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The narrow panel is `position:absolute; inset:0` inside the map root, with the z-index above the card's 3 (use 20).
  - A dropdown's `max-height` is `mapBottom - triggerBottom - 8px`, measured when it opens. Its edge is chosen by comparing `triggerLeft + width` with the map's right edge.
  - Outside-click and Esc handlers are scoped to this toolbar's root.
- [ ] **Step 4:** `npm test && npm run test:bundle`, and run e2e on Chromium and Firefox (`npx playwright test --project chromium --project firefox`) to check that the list placement didn't move.
- [ ] **Step 5: Commit:** `git commit -m "OptionsToolbar: the narrow panel, placement in MapView, kept inside the map"`
- [ ] **Step 6: Checkpoint review.** Dispatch a fresh reviewer on the most capable model over Tasks 1–6. These touch shared core and `MapView` code that every host uses. Fix Critical and Important findings with failing tests first.

### Task 7: Settings: `basemapOptions(map)`, clusters, reset, the fallback event

**Files:**
- Create: `src/lib/options/presets.ts` (`basemapOptions`, `settingsGroup`, `hmsOptions`, `schoolsOptions`)
- Modify: `src/lib/options/OptionsToolbar.svelte` (subscribe to `map.basemap.onFallback` while mounted and not `readonly`, when `basemapKey` is set), `src/lib/index.ts`
- Test: `tests/client/options/presets.test.ts`, `tests/browser/options-toolbar.browser.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** The Basemap select (one choice per basemap, value = its default variant, matches = its variants) and the Theme radios for the current basemap. Hides either row with one choice. */
  export function basemapOptions(map: MapContext, opts?: { key?: string; icons?: { basemap?: OptionIcon; theme?: OptionIcon } }): { rows: OptionRow[]; key: string; defaults: OptionValues };
  /** Monitor-map's Settings group: Marker Clusters, the basemap rows, Reset. */
  export function settingsGroup(map: MapContext, opts: { icon?: OptionIcon; clusters?: { key: string; icon?: OptionIcon } | false; basemap?: Parameters<typeof basemapOptions>[1] | false; reset?: { icon?: OptionIcon } | false }): OptionsPreset;
  export function hmsOptions(map: MapContext, opts?: { key?: string; icon?: OptionIcon }): { row: OptionRow; defaults: OptionValues };
  export function schoolsOptions(map: MapContext, opts?: { key?: string; icon?: OptionIcon }): { row: OptionRow; defaults: OptionValues };
  ```
  Default keys: `"basemap"`, `"clustered"`, `"fireAndSmoke"`, `"schools"`. Settings uses `iconOnly: true` and `align: "end"`.

- [ ] **Step 1: Write the failing tests:**
  - `basemapOptions` on `defaultBasemaps()`: 17 select choices, sorted. With `values.basemap = "outdoor-v2-dark"`, the Theme radio lists Outdoor's variants and the select shows Outdoor.
  - Picking "Satellite" in the select sets `basemap` to `"satellite-v4"` (its default variant), in one change.
  - On a Streets-only config the select row is absent.
  - `settingsGroup` defaults: `clustered: true`, `basemap: map.basemap` config's `defaultId`.
  - Browser: a failed style sends one `onchange` with `changed: ["basemap"]` and the reverted id. Read-only sends none. An unmounted toolbar sends none. A resolved unlisted id sends one (Review Focus 4).
  - `hmsOptions` / `schoolsOptions` labels are "Fire & Smoke" and "Schools & Child Care", with default `true`.
- [ ] **Step 2:** run both files. Expected: FAIL.
- [ ] **Step 3: Implement**, reading `map.basemap.styles` and `map.messages`.
- [ ] **Step 4:** `npm test && npm run test:bundle`.
- [ ] **Step 5: Commit:** `git commit -m "Options presets: Settings (basemap, Theme, clusters, reset), Fire & Smoke, schools"`

### Task 8: The feature list's host note

**Files:**
- Modify: `src/lib/view/list-placement.ts` (`FeatureListOptions.note?: string | Snippet`), `src/lib/view/MapView.svelte`, `src/lib/ui/FeatureList.svelte` (a `note` prop)
- Test: `tests/browser/feature-list.browser.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `"a note shows under the list heading and describes the listbox"`: the listbox's `aria-describedby` points at the note's id, and the note's text is the host's.
  - `"a snippet note renders"`.
  - `"no note: no element and no aria-describedby"`.
  - `"the note updates in place when the host changes it"`.
- [ ] **Step 2:** run the file. Expected: FAIL.
- [ ] **Step 3: Implement.** The note goes in a `text-xs` paragraph in `--muted-foreground`. Don't add a live region; the dashboard has its own status line.
- [ ] **Step 4:** `npm test && npm run test:bundle`.
- [ ] **Step 5: Commit:** `git commit -m "Feature list: a host note"`

### Task 9: The child-care contrast

**Files:**
- Modify: wherever `--child-care-marker`'s fallback `#1c9099` is defined (grep `1c9099` in `src/lib` and `README.md`), plus `CLAUDE.md`'s fixed-color line
- Test: `tests/unit/presets/school-icons.test.ts` (or the theme-colors test that asserts the fallback)

- [ ] **Step 1: Write the failing test** `"the child-care bubble count is at least 4.5:1 on its fill"`: compute the WCAG contrast of `#ffffff` on the fallback with the test file's own luminance helper, and expect `>= 4.5`. Add `"the school count too"` for `#5a6b7b`.
- [ ] **Step 2:** run it. Expected: the child-care test FAILS (~3.8).
- [ ] **Step 3: Implement.** Set the fallback to `#15747c`.
- [ ] **Step 4: Screenshots for the user.** Extend `.superpowers/shots.mjs` (git-ignored) to capture the badges and bubbles on Streets Default, Dark and Pastel, and on Satellite and Dataviz Dark. Include a schools count bubble's hover tooltip, and monitors with Marker Clusters on and off. Measure the badge fill against each basemap's sampled background and list the ratios (3:1 needed). Show them in the visual companion, and change the colors as the user asks. If the pair no longer reads as a pair, offer a darker school slate as well.
- [ ] **Step 5:** `npm test && npm run test:bundle`. **Commit** with the user's chosen colors: `git commit -m "Schools: a darker child-care teal, for the count's contrast"`

### Task 10: Metadata: `@sjvair/sdk` `5.0.0-beta.10`, groups and help text

**Blocked until** the sjvair.com session sends the field names and `@sjvair/sdk` `5.0.0-beta.10` is published (with the user's yes, by the coordinator). Do Tasks 1–9 first; Tasks 10 and 11 can come after Task 12's demo work if the SDK is late (the demo then shows a flat Monitors list).

**Files:**
- Modify: `package.json` (dev `@sjvair/sdk` → `npm:@jsr/sjvair__sdk@5.0.0-beta.10`; peer stays `^5.0.0-beta.2`), `src/lib/data/metadata.ts`, `src/lib/data/index.ts`, `tests/fixtures/scales.ts` and every hand-built `Scale` (add `averaging_hours`, `daily_statistic` and `daily_statistic_label`), `demo/` (drop its own `/api/2.0/pesticides/locations/` fetch if `beta.10`'s parser keeps `source`/`external_id`)
- Test: `tests/unit/data/metadata.test.ts`

**Interfaces:**
- Produces, on `MetadataProvider`:
  ```ts
  export type MonitorGroup = "reference-grade" | "low-cost";
  /** A monitor type's group. Optional: without it, the Monitors rows are a flat list. */
  monitorTypeGroup?(type: string, signal?: AbortSignal): Promise<MonitorGroup | "unavailable">;
  /** An entry type's help text. Optional: without it, no help line. */
  entryTypeHelp?(ref: ScaleRef, signal?: AbortSignal): Promise<string | "unavailable">;
  ```
  The default provider maps the server's field (name and values from the sjvair.com session) onto `MonitorGroup`. An unknown or missing value gives `"unavailable"`.

- [ ] **Step 1: Write the failing tests** with a stubbed `getMonitorsMeta`:
  - the group for each type;
  - `"unavailable"` for a type without the field and for an unknown value;
  - help for `pm25`;
  - `"unavailable"` with no help;
  - only the caller's abort rejects.
- [ ] **Step 2:** run them. Expected: FAIL.
- [ ] **Step 3: Implement**, then bump the SDK. `npm install`, then `npm run check`. Fix the `Scale` fixtures and README examples, and note the type change in the README's "Changes" (hosts that build a `Scale` add the three fields).
- [ ] **Step 4:** `npm test && npm run test:bundle && npm run test:licenses`.
- [ ] **Step 5: Commit:** `git commit -m "Metadata: monitor groups and pollutant help text; @sjvair/sdk 5.0.0-beta.10"`

### Task 11: `monitorsOptions(map)`: Pollutant and Monitors

**Files:**
- Create: `src/lib/options/monitors-options.svelte.ts`
- Modify: `src/lib/index.ts`
- Test: `tests/client/options/monitors-options.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MonitorsOptionsInput {
  	/** The tile's monitor types (its data), in display order. */
  	types: string[];
  	/** The tile's pollutants (the host's `available_pollutants` subset); the Pollutant group needs 2+, or `none`. */
  	pollutants: string[];
  	/** The chosen pollutant, to drop types that don't report it and to pick the trigger's label and icon. */
  	pollutant: string | null;
  	hasInactive?: boolean;
  	hasInside?: boolean;
  	/** Monitor-map's Collocation Sites row (shown for pm25 only). */
  	collocation?: boolean;
  	/** Adds monitor-map's "None"; while chosen, the Monitors group is disabled. */
  	none?: boolean;
  	icons?: { monitors?: OptionIcon; pollutant?: Record<string, OptionIcon>; none?: OptionIcon; collocation?: OptionIcon };
  	keys?: { pollutant?: string; type?: (type: string) => string; inactive?: string; inside?: string; collocation?: string };
  }
  /** Per map; labels resolve through the map's MetadataProvider into $state, so call `groups` in a $derived. */
  export function monitorsOptions(map: MapContext): { groups(input: MonitorsOptionsInput): OptionsPreset };
  ```
  Default keys: `"pollutant"`, `` `type:${type}` ``, `"inactive"`, `"inside"`, `"collocationSites"`. Marker icons use `triangle` and `circle` in the display color `#48c78e`; Inactive uses `#969696`; Inside uses the `#000000` outline (the fixed-color exceptions).

- [ ] **Step 1: Write the failing tests** with a stub provider:
  - types in both groups → two `group` rows ("Reference-grade" with a triangle, "Low-cost sensors" with a circle), children in input order;
  - one group only → flat `checkbox` rows, each with its group's marker;
  - a type that doesn't report the pollutant is left out (via `entryType`'s presence in `monitors[type].entries`, read through the provider). If the provider can't answer, keep the type;
  - no groups at all (provider without `monitorTypeGroup`) → a flat list, no throw;
  - Pollutant radios show label and unit from `entryType`, and help from `entryTypeHelp` when present. The group's label and icon follow `pollutant`;
  - `none: true` adds "None", and with `pollutant: null` the Monitors group is `disabled`;
  - Inactive and Inside appear only when `hasInactive` / `hasInside`; Collocation Sites only for `pm25`;
  - labels arrive after the first call, and a `$derived` over `groups(...)` re-runs (use `rootEffect`).
- [ ] **Step 2:** `npx vitest run --project client tests/client/options/monitors-options.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the per-instance `$state` caches keyed by type and pollutant, filled on first need with an `AbortController` per map. Never module-global.
- [ ] **Step 4:** `npm test && npm run test:bundle`.
- [ ] **Step 5: Commit:** `git commit -m "Options presets: Pollutant and Monitors from the metadata"`

### Task 12: Demo, e2e, screenshots

**Files:**
- Modify: `demo/App.svelte` (the right-hand map gets an `OptionsToolbar` with `monitorsOptions`, `hmsOptions`, `schoolsOptions` and `settingsGroup`, wired to its plugins and `map.basemap.select`, with Lucide icons passed as inline SVG snippets so the demo adds no dependency), `e2e/demo.spec.ts`, `e2e/fixtures/*` if a new endpoint is hit
- Test: `e2e/demo.spec.ts`

- [ ] **Step 1: Write the failing e2e tests:**
  - `"toolbar toggles Fire & Smoke at a still view and the list updates"`: `zoomTo(14)` first, then check that the list's rows change without a camera move.
  - `"basemap select switches to the default variant"`.
  - `"Shift-click marks without a card"`: this pins the dashboard's DEFERRED test gap.
  - `"narrow viewport gets the options button"`.
  - `"touch: tap opens a dropdown; no hover"`: touch emulation.
- [ ] **Step 2:** `npx playwright test --project chromium --project firefox`. Expected: FAIL, then implement the demo until it passes.
- [ ] **Step 3: Screenshots for the user**, in the visual companion:
  - the wide and narrow toolbars at a 300px tile and a full window;
  - each dropdown open;
  - both Monitors forms (headings and flat);
  - read-only;
  - the middle widths (~800px) to judge the deferred icons-only layout.

  Expect a round of changes.
- [ ] **Step 4: Commit:** `git commit -m "Demo and e2e: the options toolbar"`

### Task 13: Docs and version

**Files:**
- Modify: `README.md`, `tests/unit/readme-examples.test.ts`, `CLAUDE.md`, `package.json` (`0.1.0-beta.13`), and the data-dashboard docs worktree (`../data-dashboard/.worktrees/docs-map-sdk`, on `origin/step-5`)

- [ ] **Step 1: README:**
  - `OptionsToolbar`, its props and value model;
  - each preset;
  - `MapView`'s `toolbar` prop and `--mapsdk-toolbar-height`;
  - `featureList.note`;
  - `BasemapStyle`, `resolve`, `onFallback`, and the full `defaultBasemaps()`;
  - the two `MetadataProvider` methods;
  - "Changes" for `0.1.0-beta.13`: name every new `mapsdk_options_*` key and API, the three fixes, the `Scale` fields, and `select` resolving unknown ids;
  - the token list (the new `--child-care-marker` fallback).

  Add an example to `readme-examples.test.ts`: a toolbar over `settingsGroup`, `hmsOptions` and `monitorsOptions` wired to plugins.
- [ ] **Step 2: `CLAUDE.md`:** an "Options" architecture bullet, the basemap and `MapView` lines, the list note, the fixed-color line's new teal.
- [ ] **Step 3:** run `npm run format && npm run lint && npm run check && npm test && npm run test:bundle && npm run test:licenses`, then e2e on Chromium and Firefox.
- [ ] **Step 4: Commit:** `git commit -m "0.1.0-beta.13: the options toolbar"`
- [ ] **Step 5: data-dashboard docs.** Ask the coordinator first if a spec PR into `step-5` is open. Then:
  - update map-sdk's `TODO.md` row;
  - in `DEFERRED.md`, remove exactly the done entries: "Shift-click on the Map also opens the reading card", "map-sdk's spoken view summary goes stale", "The hidden-marks note isn't in map-sdk's feature list", "map-sdk: the child-care bubble count's contrast", "map-sdk: map-sdk's dev `@sjvair/sdk` is `5.0.0-beta.3`";
  - update "the middle, icons-only layout" with what the screenshots showed, and "the pinned card covers what's under it" (revisit with part 5): keep it, saying the toolbar's panel now sits above the card;
  - check the diff removes nothing else.

  Commit, `git pull --rebase origin step-5`, run prettier on `TODO.md`, then `git push origin HEAD:step-5`.

### Task 14: Final review and PR

- [ ] **Step 1:** dispatch a fresh whole-branch review on the most capable model. Fix Critical and Important findings with failing tests first. Re-grade minors by what a user would hit.
- [ ] **Step 2:** show the user the final screenshots. **Ask for their yes** before pushing and opening the PR. Merge only with their yes, after CI passes on the last commit. The release is a separate yes: `gh release create v0.1.0-beta.13 --target <full merge SHA> --prerelease --title 0.1.0-beta.13 --notes-file <file>`. Then watch `release.yml` in the background and check `npm view @sjvair/map-sdk dist-tags --prefer-online`.
- [ ] **Step 3:** tell the coordinator (`data-dashboard-22`) about the PR and the release, with full versions.
