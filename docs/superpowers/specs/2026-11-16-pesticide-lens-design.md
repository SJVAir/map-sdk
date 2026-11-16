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
7. **Approach B for the lens** (below), as its own plugin.
8. **A click or tap opens a card only; only `pin` pins the lens** (the dashboard's spec 5; this
   replaces the Explorer's tap-to-pin from the builder check, with no option to keep it).

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
data and content choice stays with the host. Planning then showed that a lens inside the parents'
plugin mixes two kinds of feature in one list, legend and summary line ("12 Townships" counting
sections), so the user made the lens its own plugin, `shapesLens` (section 4).

## Goals

- `shapesPlugin`: `zoomRange`, a rich `tooltip`, `legendUnits` and `legendNote`.
- `shapesLens`: the lens, its own plugin over a choropleth `shapesPlugin`.
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
- The lens (`shapesLens`, below) takes its own `legendUnits` and `legendNote`.

### 4. `shapesLens({ parents, … })`

A lens is its own plugin, added right after its parents' plugin. It draws child shapes
(sections) around the parent (township) under the pointer, and hides those parents beneath it.
The user, 2026-11-16 (after the spec's first approval): a separate layer, so the list, the legend,
the cards and the view summary treat sections as sections through the code that already exists,
instead of the parents' plugin carrying a second kind of feature.

```ts
const townships = shapesPlugin({ id: "townships", mode: "choropleth", zoomRange: { max: 11 }, … });
const lens = shapesLens({ id: "lens", parents: townships, source, block, parentOf, layerLabel, … });
createMap({ plugins: [townships, lens, sections, notices] });
```

```ts
export interface ShapesLensOptions<C extends MapFeatureProperties> {
	id: string;
	/** The parents' plugin (a `shapesPlugin`, choropleth). Add the lens right after it. */
	parents: MapPlugin;
	/** The children. The host fills it for `center`, typically on a short debounce. */
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
}

export interface ShapesLens extends MapPlugin {
	/** Reactive: the parent the lens is centred on, or null. */
	readonly center: string | null;
	/** Reactive: pinned by `pin`. */
	readonly pinned: boolean;
	/** Centres the lens on `refKey` and pins it ("Show square miles"). */
	pin(refKey: string): void;
	/** Unpins and drops the lens. */
	release(): void;
}
```

`shapesLens` throws when `parents` isn't a choropleth `shapesPlugin` (it needs the parents'
internal hooks: their source for feature state, their shown-in-range flag). The lens draws its
children with the shapes drawing already there (fill, outline mode, `noFigure`), coloured by its
own source's scale; the dashboard passes the section `ScaleRef`, so the lens shares a legend
section with the zoomed-in sections plugin. Its children are never selectable. It has its own
`legend()`, `tooltip` and hit plugin id, so cards, list and summary need nothing new.

**The rules** (the Explorer's hover, the dashboard's pinning; the user, 2026-11-16):

- **What counts as "over the lens".** The lens follows the topmost parent or drawn child under
  the pointer, even when another plugin's marker is on top of it (a notice or monitor inside the
  block), so resting on a notice inside the lens never drops it (the user, 1a). This needs the
  router to give each plugin its own hit under the pointer, not only the top hit (see
  `PluginContext` below).
- **Hover raises it.** When the pointer is over a parent, the lens centres on it (unless pinned).
- **Recentring.** When the pointer is over a drawn child whose `parentOf` isn't the centre, the
  lens recentres on that parent (unless pinned).
- **Grace.** When the pointer is over no parent and no drawn child (off the map, or over another
  plugin's feature with neither beneath it), the lens drops after 120 ms (the Explorer's
  `LENS_CLEAR_DELAY_MS`), unless the pointer comes back first or the lens is pinned. Moving between
  a parent and its children never drops it. A recentre after the clear was scheduled cancels it.
- **The card is part of the hover (WCAG 1.4.13, hoverable).** While the pointer is over the map's
  tooltip or card element, the lens keeps its centre: moving from the lens onto the township's
  card never drops it, and the grace starts only when the pointer leaves the card for somewhere
  that isn't over the lens.
- **Esc dismisses (WCAG 1.4.13, dismissible).** Esc while an unpinned lens shows drops it without
  moving the pointer; it doesn't come back until the pointer is over a different parent or leaves
  and returns. (Esc on a pinned card keeps today's behaviour: it closes the card, and below.)
- **A click or tap opens a card only** (the dashboard's spec 5, Part 2: "On touch, a tap opens
  the card and never the lens directly"; the user chose this over 2a, with no option to keep the
  Explorer's tap). A click on a parent pins its card and doesn't pin the lens; mouse hover still
  moves the unpinned lens. **Hover that comes from touch is ignored by the lens** (the browser's
  emulated mouse events after a tap), so on touch the lens appears only through `pin`. The router
  knows a touch from its `pointerdown` pointer type; it marks hover from touch (see `PluginContext`).
- **Pinning.** `pin(refKey)` centres the lens there and pins it; the township card's "Show square
  miles" calls it, for keyboard and touch alike. While pinned, hover doesn't move it. It is
  released by `release()` (the host calls it when another township is picked), Esc, or the pinned
  card closing (Close, a click on nothing) or moving to a feature that is neither a parent of the
  block nor a drawn child nor another plugin's feature inside the block. Clicking a lens child
  pins that child's card and the lens stays pinned. With the lens unpinned, a pinned card on a
  drawn child also holds the lens where it is, so the card's section doesn't vanish under it; the
  hold ends when that card closes. A card on another plugin's feature (a notice) doesn't hold it:
  those draw above the lens (the user, 2026-11-16, after the final review). List focus moving the
  card never releases a pinned lens, so keyboard users can walk the list to the sections (the
  final review's finding, fixed the same day).
- **Only in range.** The lens never shows while the parents are out of their `zoomRange`, and drops
  (and releases) if the zoom leaves it.
- **The lens or its parents detaching, or the map detaching** drops the lens with no timer left
  running.

**Drawing.**

- Children are drawn only when `parentOf` is in `block(center)`, so a host can leave neighbouring
  blocks in the source (its cache) and stale data for an earlier centre never shows.
- A parent in the block loses its fill only once at least one of its children is drawn (feature
  state on the parents' source, so no data reload). Until the children arrive, the parents keep
  their colours: the block never shows empty.
- The lens's layers sit in its own draw slot, right above the parents. The centre parent's
  outline draws over the children (a 2px `--foreground` line, the Explorer's hovered-township
  outline), as a lens layer.

**Listing, cards and legend.**

- `features()` lists the drawn children only while the lens is **pinned** (so keyboard users reach
  the sections after "Show square miles"), and lists nothing while it's only hovered (so the list
  doesn't churn under a moving pointer). Items have `selectable: false`.
- `legend()` gives the lens's section while children are drawn, and `null` otherwise (decision 3).
- The view summary needs nothing: the lens is a plugin with its own `layerLabel`, and it sets
  `summarizeEmpty: false`, so the summary has no "0 Sections" line while the lens is down.

**What `PluginContext` needs.** Read-only and additive:

- `hoverOf(pluginId: string): (Hovered & { touch: boolean }) | null`, reactive: that plugin's own
  topmost hit under the pointer and where, whatever lies on top of it (another plugin's marker, a
  blocking layer such as a cluster bubble), and whether the move came from touch. Null off the
  map and on `mouseout`. It changes only when the hit's refKey, or `touch`, changes, not on every
  move. A non-hoverable plugin's features count. `map.hovered`, the tooltip, the cursor and every
  other plugin are unchanged.
- `pinned` and `focusedKey`, reactive (the map's).
- `pointerInCard`, reactive: the pointer is over this map's tooltip or card element (`MapTooltip`
  reports it).

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

- Internal structure of the lens (wrapping an inner `shapesPlugin` for the children, or the
  layers built in place) and of the parents' internal hooks.
- Count marker sizes and text size.
- Test layout across `unit`, `client`, `browser` and e2e. Hover rules need browser tests with the
  real pointer (`park-pointer.ts` in `afterEach`).
