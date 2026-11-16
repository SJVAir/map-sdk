# Pesticide use by township and section, and spray notices (0.1.0-beta.17)

Date: 2026-11-16. For the SJVAir Dashboard's Map widget (data-dashboard Release 1, step 5, spec 5).

## Why

The dashboard's Map widget will show pesticide use. Zoomed out it shows townships (6×6 mile PLSS
townships), and from about zoom 11 it shows sections (one square mile). It also shows spray
notices. The sjvair.com Pesticides Explorer (`sjvair.com/assets/js/pesticides/section-map.js`)
already does this with hand-written MapLibre code; the dashboard needs it from map-sdk.
map-sdk today has no zoom range on shapes, no rich shapes cards, no way to open a township into its
sections, no count on a point marker, and no host text in the legend.

Everything here is opt-in. A host that sets none of the new options sees no change (monitor-map 5.0
and mobile use this package).

## What the dashboard decided (2026-11-16)

- Townships zoomed out, sections from about zoom 11, swapping with no gap. The host loads both by
  bbox as the view moves (from `map.bounds`) and passes plain `DataSource`s.
- Server class breaks colour them, through a stable `ScaleRef` (the same object on every read). The
  lens's sections use the same section `ScaleRef` as the zoomed-in sections.
- **The lens:** hovering a township shows its 3×3 neighbourhood as sections, drawn over the
  townships, with the townships beneath hidden there. The keyboard and touch path is a "Show square
  miles" button on the township's card, which pins the lens until Esc or Close.
- **Cards:** a section card has figures, top chemicals with badges, a 12-month bar chart and a
  link; a township card has figures, a section count, and the actions "Show square miles" and
  "Zoom in"; a notice card has dates, products and a link. Only monitors are selectable; no
  pesticide feature is.
- **Notices:** one marker per section with a count of the notices there, clustering when zoomed far
  out.
- **Legend:** a unit line per layer ("lbs per township"), the "No data" row, and a note for
  explainer text the host supplies.
- The dashboard never injects HTML: host content is a Svelte `Snippet` or plain text, never a
  markup string.

## Decisions made in this brainstorm (the user, 2026-11-16)

1. **One beta.** Everything ships in `0.1.0-beta.17`; nothing lands early.
2. **The lens follows the Explorer** (`recenterLens`, `scheduleLensClear`): it recentres as soon as
   the pointer is over a section of a neighbouring township, so the township under the pointer is
   always the centre.
3. **The legend shows only the layers drawn now:** townships zoomed out, sections from the swap
   zoom, both while the lens is up.
4. **The legend note is host content under the layer's section** (a `Snippet`, per the dashboard's
   rule above), not one note for the whole legend.
5. **Notice markers look like the Explorer's (mockup A):** a count of 1 is a plain dot; 2 or more
   is a larger circle with the number in it; a cluster is the same look, larger, with the summed
   count.
6. **The proposed legend look:** the host's unit line sits on its own line under the section's
   title, in the legend's secondary text colour, in place of today's "(units)" after the title.
   The note sits at the foot of the section, below "No data". Without a unit line, today's look
   stays.
7. **Approach B for the lens** (below).

## Approaches considered (for the lens)

- **A. Small general pieces; the host writes the lens rules.** `shapesPlugin` gets a reactive
  hidden-keys set; the host watches `map.hovered`/`map.pinned`, runs the grace timer, recentring
  and pinning, and feeds a second `shapesPlugin`. Small for map-sdk, but the hard part (the
  Explorer's flicker and event-order fixes) moves to the dashboard, untested against map-sdk's
  hover routing.
- **B. A general lens in map-sdk; the host supplies data. (Picked.)** `shapesPlugin` gets a `lens`
  option: parent shapes that open into child shapes. map-sdk owns the hover, recentre, grace, pin,
  Esc, and hiding the parents beneath; the host fills the child source for the lens's centre.
  Tested in map-sdk with real hover events, and nothing in it is pesticide-specific.
- **C. A pesticide preset** bundling townships, sections, lens and notices (like `hmsFirePlugin`).
  Most turnkey, but it bakes the dashboard's data shapes into map-sdk, and the cards are host
  snippets anyway, so it adds little over B.

The user picked B: the lens rules are where the bugs live, and B keeps them in map-sdk while every
data and content choice stays with the host.

## Goals

- `shapesPlugin`: `zoomRange`, a rich `tooltip`, `legendUnits`, `legendNote`, and `lens`.
- `pointsPlugin`: a count label on markers (`count`), summed in clusters, in the Explorer's look;
  plus `legendUnits` and `legendNote`.
- The legend: the unit line and the note, per section; shared sections take the first member's.
- Measure moving the map with ~2500 sections in view; act on the deferred "faster in-view test for
  shapes" only if it is measurably slow.

## Non-goals

- Fetching anything (presets never fetch; the host loads by bbox and for the lens's centre).
- Selecting pesticide features (they stay `selectable: false`).
- A pesticide preset, or pesticide-specific types or messages.
- Notice bubbles splitting into section markers under the lens (the Explorer's township bubbles):
  the dashboard's notices are per section at every zoom.
- The older features missing from the demo (the open deferral); only this work's go in.
- Antimeridian handling: unchanged, and nothing here may make it worse.

## Anti-goals

- Any change for a host that sets none of the new options (draw order, list, legend, hover, cards).
- The lens flickering, jumping under a resting pointer, or flashing an empty block while its data
  loads.
- Host HTML strings anywhere.

## The design

### 1. `shapesPlugin({ zoomRange })`

`zoomRange?: { min?: number; max?: number }`, exactly as `pointsPlugin`'s (`points.svelte.ts:107`):
visible from `min` (inclusive) to `max` (exclusive) of the camera zoom, by layer `visibility`
switched on `zoom`, not layer min/maxzoom, so a townships plugin `{ max: 11 }` and a sections plugin
`{ min: 11 }` leave no gap on a globe.

Out of its range, a shapes plugin (new behaviour, only with `zoomRange` set):

- is not hovered or clicked (its layers are hidden, so they aren't rendered);
- lists no features (`features()` returns `[]`), so the feature list and view summary don't show
  hidden townships at zoom 12;
- gives no legend (`legend()` returns `null`), per decision 3.

This needs the plugin's `features()` and `legend()` to re-run when the range flips: a per-plugin
`$state` "shown" flag set from setup's zoom listener (the same flag that sets visibility). The map
re-derives the list when a plugin's features change at a still view (an earlier lesson).

`pointsPlugin`'s `zoomRange` is unchanged (it still lists and legends out of range); changing it is
not asked for and would change hms-fire hosts.

### 2. `shapesPlugin({ tooltip, tooltipShowsName })`

The same shape as `pointsPlugin`'s:

```ts
tooltip?(item: FeatureListItem, props: P, env: ShapesTooltipEnv): Snippet | undefined;
tooltipShowsName?: boolean;
```

`ShapesTooltipEnv` is `Providers` plus `scale` and `precision`, like `PointsTooltipEnv` (one shared
type if that's clean). `props` are the feature's source properties, looked up by refKey from the
latest data. It feeds `MapPlugin.tooltip`, so it shows in the hover tooltip and in the pinned card
(`MapView`'s `card`), where links and buttons work. The host's card actions stay `card.actions`.

### 3. `legendUnits` and `legendNote` (shapes and points)

```ts
/** Already-translated unit line under the legend section's title, e.g. "lbs per township". */
legendUnits?: string;
/** Host content at the foot of the plugin's legend section, below "No data". */
legendNote?: Snippet;
```

- `LegendData`'s scale variant and `LegendSection` gain `unitsLine?: string` and
  `note?: Snippet`. A section with `unitsLine` draws it as its own line under the title
  (secondary text, `text-xs`, `--muted-foreground`) and leaves out the "(units)" after the title;
  without it, the title is as today.
- The note renders at the section's foot in a `text-xs` block. map-sdk only places it; the snippet
  owns its content (a link, a help button).
- `shareSections`: a shared section takes the first member's `unitsLine` and the first member's
  `note` that are set, the same rule as `scaleLabel`.
- The lens (below) takes its own `legendUnits` and `legendNote`.

### 4. `shapesPlugin({ lens })`

A shapes plugin with `lens` draws parent shapes (townships) that open into child shapes (sections)
around the one under the pointer.

```ts
lens?: {
	/** The children. The host fills it for `lens.center`, typically on a short debounce. */
	source: DataSource<C>;
	/** The parents whose children the lens shows when centred on `refKey`, itself included. */
	block(refKey: string): string[];
	/** A child's parent refKey (for recentring and for which parents to hide). */
	parentOf(props: C): string | null;
	/** Already-translated name of the children, for the list, summary and legend. */
	layerLabel: string;
	fillOpacity?: number;
	outline?: "theme" | "level" | "none";
	noFigure?: "neutral" | "outline";
	tooltip?(item: FeatureListItem, props: C, env: ShapesTooltipEnv): Snippet | undefined;
	tooltipShowsName?: boolean;
	legendUnits?: string;
	legendNote?: Snippet;
};
```

Choropleth only (a `plain` plugin with `lens` throws at creation). The children are drawn by the
plugin itself, coloured by the lens source's own scale (the dashboard passes the section
`ScaleRef`; it then shares a legend section with the zoomed-in sections plugin).

**What the host gets back.** `shapesPlugin` returns `ShapesPlugin`, a `MapPlugin` plus, with
`lens`:

```ts
lens: {
	/** Reactive: the parent the lens is centred on, or null. */
	readonly center: string | null;
	/** Reactive: the lens is pinned (by `pin`, or a lens card). */
	readonly pinned: boolean;
	/** Centres the lens on `refKey` and pins it ("Show square miles"). */
	pin(refKey: string): void;
	/** Unpins and drops the lens. */
	release(): void;
};
```

The control is on the plugin, not `MapContext`, so two lensed plugins never share one, and nothing
changes for hosts without a lens. (This replaces the `map.lens` name in the brainstorm's sketch.)

**The rules** (the Explorer's, from `section-map.js`):

- **Hover raises it.** When the map's hover is one of this plugin's parents, the lens centres on it
  (unless pinned).
- **Recentring.** When the hover is one of the lens's children whose `parentOf` isn't the centre,
  the lens recentres on that parent (unless pinned). The hover follows `map.hovered` (the router's
  result), not layer `mousemove` listeners, so the Explorer's listener-order fixes aren't needed.
- **What counts as "over the lens".** The lens follows this plugin's own topmost feature under
  the pointer (a parent or a drawn child), even when another plugin's marker is on top of it (a
  notice or monitor inside the block): the user, 2026-11-16 (builder check, 1a), so resting on a
  notice inside the lens never drops it. This needs the router to give each plugin its own hit
  under the pointer, not only the top hit (see `PluginContext` below).
- **Grace.** When the pointer is over none of the plugin's parents and the lens's children (off
  the map, or over another plugin's feature with nothing of this plugin beneath), the lens drops
  after 120 ms (the Explorer's `LENS_CLEAR_DELAY_MS`), unless the pointer comes back first or the
  lens is pinned. Moving between a parent and its children never drops it. A recentre after the
  clear was scheduled cancels it.
- **Pinning.** The lens is pinned while `pin()` set it, or while the pinned card (`map.pinned`) or
  the keyboard-focused item is the centre parent, one of the lens's children, or another plugin's
  feature lying inside a drawn child or a parent of the block (a notice card opened inside a
  pinned lens keeps it pinned; the user, 1a). While pinned, hover doesn't move it. It is released
  when `release()` is called, or when the pinned card closes (Esc, Close, a click on nothing) or
  moves to a feature outside the block. Clicking a lens child pins that child's card, and the lens
  stays pinned.
- **Only in range.** The lens never shows while the plugin is out of its `zoomRange`, and drops if
  the zoom leaves the range.
- **Touch and clicks.** A tap raises the lens, as in the Explorer (the user, 1a on the touch
  question): the browser's emulated hover after the tap centres it, and the tap pins the parent's
  card, which pins the lens. A mouse click on a parent does the same. The next tap or click on a
  child pins the child's card, and the lens stays. No touch special case: hover from touch is
  treated like any hover. "Show square miles" (`lens.pin(refKey)`) is then the keyboard path
  (list focus gives no hover), and still works for any input.
- **The plugin detaching, its source emptying, or the map detaching** drops the lens with no
  timer left running.

**Drawing.**

- Children are drawn only when `parentOf` is in `block(center)`, so a host can leave neighbouring
  blocks in the source (its cache) and stale data for an earlier centre never shows.
- A parent in the block loses its fill only once at least one of its children is drawn (by feature
  state, so no data reload). Until the children arrive, the parents keep their colours: the block
  never shows empty.
- The child layers draw above the parent fill and outline, in the plugin's draw slot, and are
  interactive under the same plugin id. The centre parent's outline draws over the children (a
  2px `--foreground` line, the Explorer's hovered-township outline).
- Children use the shapes drawing already there (fill, outline mode, `noFigure`), built from the
  lens's own scale.

**Listing, cards and legend.**

- `features()` lists the children while the lens is **pinned** (so keyboard users reach the
  sections after "Show square miles"), and doesn't list them while it's only hovered (so the list
  doesn't churn under a moving pointer). Child items have `selectable: false`.
- `tooltip(item)` dispatches by the item: a child's to `lens.tooltip`, a parent's to the plugin's
  `tooltip`. `tooltipShowsName` the same way.
- `legend()` gives the parent section; while children are drawn it also gives the lens's section.
  `MapPlugin.legend` returns one `LegendData` today, so this needs `legend()` to be able to return
  several (an array), or an equivalent the Legend reads. `shareSections` then merges the lens's
  section with the zoomed-in sections plugin's when their `ScaleRef`s are equal.

**What `PluginContext` needs.** Read-only and additive:

- a reactive `ownHover`: this plugin's own topmost hit under the pointer and where (a
  `Hovered | null`), whatever lies on top of it, including when the top hit is another plugin's
  or a blocking layer's (a cluster bubble). Null off the map and on `mouseout`. The router already
  queries every registered layer under the pointer on each move; it keeps the topmost hit per
  plugin alongside `hovered`. A non-hoverable plugin still gets its own.
- reactive `pinned` and `focusedKey` (the map's), so the plugin can apply the pinning rule.

`map.hovered`, the tooltip, the cursor and every other plugin are unchanged.

### 5. `pointsPlugin({ count })`

```ts
/**
 * A number on each marker from a property (e.g. notices per section): a count of 1 is a plain
 * marker, 2 or more a larger circle with the number in it. Clusters sum it and show the sum the
 * same way, larger. Circle markers only (not with `icon`).
 */
count?: { property: string };
```

- The marker colour is the level colour as today (the host can pass a one-level literal `Scale` to
  colour notices, or none for the neutral colour). The number is `--background`-on-colour text
  with a 1.5px `--background` stroke on the circle; sizes as the Explorer's
  (`NOTICE_MARKER`, `NOTICE_GROUP_RADIUS`) as a starting point, exact values the builder's call.
- With `cluster`, map-sdk adds a `clusterProperties` sum of the property (namespaced, e.g.
  `mapsdk:count`), and the bubbles show it in the same look instead of the neutral count bubbles.
  A host `cluster.layers` still wins. The cluster tooltip's `ClusterInfo.properties` carries the
  sum.
- The list, accessible names and generic tooltip are unchanged (the count is a marker label, not
  the value).
- Real basemap styles have glyphs; the e2e style has none, so e2e checks the layers and properties,
  not the drawn text.

### 6. Measuring 2500 sections

Before the PR: a browser or e2e benchmark moving the map with ~2500 section polygons in view,
timing `features()` and the list/summary derivations per move. If a move's map-sdk work is over a
frame (16 ms) on the dev machine, do the deferred faster in-view test (skip the exact test when the
label point or whole bbox is inside the view) in this beta; otherwise report the number to the
coordinator for `DEFERRED.md`.

## Constraints

- Svelte 5 runes; tokens only for colour, with the fixed exceptions in `CLAUDE.md`; every string a
  `mapsdk_*` key (this design adds none: units, labels and notes are the host's).
- Colour never alone: lens children keep the outline and the legend's labels.
- `prefers-reduced-motion`: the lens has no animation.
- Two maps share nothing: lens state is per plugin instance and per map.
- `test:bundle`: `./data` and `./stores` stay off the map engine (nothing here touches them).
- README "Changes", token list, examples and `tests/unit/readme-examples.test.ts`; CLAUDE.md
  architecture lines; version `0.1.0-beta.17` in the same PR.

## Left to the builder

- Internal structure of the lens (a nested `shapesPlugin` through `scopedContext`, as `hmsFirePlugin`
  nests, or the layers built in place).
- The multi-section `legend()` shape, as long as existing plugins' `legend()` still works.
- Count marker sizes and text size.
- Test layout across `unit`, `client`, `browser` and e2e. Hover rules need browser tests with the
  real pointer (`park-pointer.ts` in `afterEach`).

### 7. The demo (the user, 2026-11-16: yes)

The demo gets a pesticide map: mock townships and sections (a small grid of square polygons in
the Valley with refKeys and `mtrs`-like ids, so `block` and `parentOf` are simple), a section
`ScaleRef` with mock class breaks in the demo's metadata, a notices points source with counts and
clusters, the cards (section tooltip, township tooltip, "Show square miles" and "Zoom in" actions),
and legend unit lines and a note. The data is static fixtures in `demo/` and `e2e/fixtures/`
(nothing new on sjvair.com; the demo's existing `/api/` stubs pattern). e2e then covers: the zoom
swap, hover raising and recentring the lens, Esc releasing a pinned lens, and the count layers and
cluster sum property (not drawn text: the e2e style has no glyphs).

This doesn't add the older features the deferred "demo page doesn't show the newer opt-in
features" lists; that entry stays open for the coordinator, with this work noted.
