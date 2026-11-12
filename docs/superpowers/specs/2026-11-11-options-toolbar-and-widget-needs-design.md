# Options toolbar, pinned card, selection, focus area, and schools — design

Date: 2026-11-11. From `main` 7029792 (`@sjvair/map-sdk` `0.1.0-beta.7`).

This spec covers items 3–7 of the "map-sdk changes" in data-dashboard's step 5 spec 1
(`docs/superpowers/specs/2026-11-11-step-5-spec-1-map-widget-design.md` on data-dashboard
`origin/step-5`). Those items are requirements; this document is the design. Where a choice below
is the user's, it says so ("decided"); where it's this spec's, it says "my call", and the builder may
revisit those with a reason.

## Why

The dashboard's Map widget (data-dashboard step 5, spec 2) needs:

- an options toolbar like monitor-map 5.0's, working on a small tile;
- a reading card that stays put when clicked or tapped, with the widget's own Select and Remove
  buttons on it;
- selection by Shift/Cmd/Ctrl-click, with a plain click only showing the card, and a way to refuse
  a pick;
- a "focus area" that outlines the widget's place and fades everything outside it;
- schools and child-care centers on the map.

The user decided on 2026-11-11 that the toolbar is **shared**: map-sdk owns it, and
`@sjvair/monitor-map` 5.0 moves onto it, replacing its own toolbar (`src/lib/options/` on
monitor-map `release/5.0.0`). Through monitor-map's `monitorMapRoutes`, mobile gets it too.

There's also a bug that can't wait for the rest. In the widget's end-to-end tests on Chromium and
WebKit, a tap on a monitor doesn't reliably show its reading. The browser's emulated `mousemove`
shows the hover card, and the `click` right after it hides it. The pinned card fixes this, so it
ships first, on its own (decided, see "Order of work").

## Consumers (don't break any)

- **The dashboard's Map widget** pins map-sdk exactly (`0.1.0-beta.7` today). Several maps per
  page, each a tile that clips its contents, often ~300px wide on a wide screen, plus a fullscreen
  view. View-only and shared dashboards can't change saved options.
- **`@sjvair/monitor-map` 5.0** (`release/5.0.0`, on `@sjvair/map-sdk` `0.1.0-beta.6`). Its map fills
  the window. A click on a monitor opens the monitor details panel (its route) and zooms in; it uses
  `selectionMode: "single"`. Its move onto the shared toolbar happens in a monitor-map session, not
  here.
- **Mobile** renders monitor-map's map through `@sjvair/monitor-map/routes`. Phones and touch.

Every new behavior below is opt-in. A host that changes nothing gets exactly today's map.

## Goals

1. A shared options toolbar that covers everything monitor-map 5.0's does (list below), built from
   declarations the host passes, with values the host owns.
2. A pinned reading card, turned on by the host, with a slot for host buttons.
3. A selection mode where a plain click pins the card and a modifier-click selects, plus a host
   hook that refuses a pick before it shows.
4. A focus area (outline, casing, and faded surround) for a polygon, and an outlined ring with a
   label for a point.
5. A schools and child-care preset.

## Non-goals

- Items 8–11 of spec 1's list (monitor readings at display precision, data-driven shading
  classes, count labels on points, a distance ring), and spec 1's "nice to haves" (`initialView`
  as a bbox, a runtime `cooperativeGestures` setter). They are later dashboard specs. Nothing here
  should make them harder: in particular, the focus area's point ring and the schools preset are
  where a distance ring will later attach.
- Moving monitor-map onto the toolbar (monitor-map's session), and any change to the dashboard,
  monitor-map, mobile, sdk-js, or sjvair.com.
- A third, "icons only" toolbar layout between the wide and narrow ones (see "Deferrals").
- The RTL text plugin option: dropped by the user on 2026-11-11 ("we will deal with RTL if we end
  up needing it"); the dashboard records it in its `DEFERRED.md`.

## Anti-goals (failure even if it works)

- monitor-map, or a phone through mobile, behaves differently from today after taking a new
  map-sdk version without opting in to anything.
- The toolbar changes a value by itself. It only shows values and reports the user's changes.
- A dropdown or panel that spills outside a tile, or is cut off by the tile's frame.
- Page-wide state: two maps on a page share an open menu, a card, or values.
- Color as the only signal: schools vs. child care, the focus area, a refused pick.
- Hardcoded labels, units, or colors outside tokens and the metadata (see `CLAUDE.md`'s "Rules that
  bind new code").

## Order of work

Decided by the user: one spec, then separate pull requests in this order. Each PR carries its own
version bump. **Each release is a separate yes from the user, every time.**

1. **Pin-on-click card**, without host buttons. Its own small release, ahead of the rest, to
   unblock the dashboard's spec 1.
2. **The card's host buttons, the click-pins/modifier-selects mode, and the refuse-a-pick hook.**
3. **The focus area.**
4. **Schools and child care.**
5. **The options toolbar**, with the presets' ready-made declarations. It goes last because it's
   the biggest piece and its declarations cover the other presets.

Part 1 must be designed so part 2 adds the buttons without a breaking change.

## 1. Pinned reading card

### Decided

- The host turns it on. monitor-map doesn't, and keeps opening its details panel on click.
- When on, a click or tap on a feature pins that feature's card: the same content the hover card
  shows today (`MapTooltip`, `TooltipItem`, and each plugin's `tooltip`).
- The pinned card takes pointer events. It closes with Esc, with its own close button, or with a
  click on the map outside it.
- Focusing a row in the feature list shows the same card (with the same buttons, once part 2
  lands).
- Non-modal: focus never moves into the card by itself. The user can move it in, and closing the
  card returns focus to where it was.

### My calls

- **The switch** is a `MapView` prop that takes `true` now and an options object later, e.g.
  `card?: boolean | { actions?: Snippet<[CardContext]> }`, so part 2 adds `actions` without a
  break. The builder picks the name and shape.
- **One card at a time.** While a card is pinned, the hover card doesn't show; a click on another
  feature moves the pin there. A click on empty map, or on a feature with no card (see below),
  closes it.
- **What gets a card on click:** whatever gets a hover card today. Cluster bubbles keep zooming in
  on click and don't pin. Smoke plumes have no hover card (the parity decision in
  `0.1.0-beta.4`), so a click on one pins nothing, while focusing a plume's row still shows its
  card, as today.
- **`featureclick` still fires** for every click, card or not. The card is shown in addition to
  it, not instead.
- **The card never changes selection rules.** With the card on and the default pick mode, a click
  selects exactly as today *and* pins the card, and a tap in `"multiple"` mode still adds. Only
  part 2's `"modifier"` mode changes what a plain click selects. Part 1 releases first, so this is
  the behavior part 2 must keep.
- **The card follows its feature** as the map moves, anchored the way the pinned hover card is
  today (including the in-view anchor for a large shape, `shapeAnchor`/`anchorFor`). It hides
  while its anchor is off-screen and returns when it's back. It closes when its feature leaves
  the data (a poll that drops the monitor, or its plugin is removed or hidden).
- **Tap must be reliable.** The emulated `mousemove` → `click` sequence of a tap ends with the
  card pinned, every time, on Chromium, Firefox, and WebKit. That is the bug this part fixes, and
  it gets an e2e test with touch emulation.
- **Keyboard path in:** the builder picks a pattern that meets the non-modal rule and WCAG 2.2 AA.
  One that fits: from the feature list, a key (announced in the listbox's description) moves focus
  to the card's first control; Esc or the close button in the card returns focus to the row. A
  card pinned by a click leaves focus where it is (the map canvas or the page); Tab then reaches
  the card next in order.
- **Esc** closes the innermost open thing first: an open toolbar dropdown, then the card, then the
  feature list panel.
- **Close button** label is a new message key (e.g. `mapsdk_card_close`, "Close").
- The card keeps today's look and size rules (`mapsdk-tooltip`, `mapsdk-tooltip-wide`), and stays
  inside the map's box.

## 2. Host buttons, selection mode, and refusing a pick

### Decided

- The card has a slot for the host's buttons (the dashboard's Select and Remove).
- A selection mode where a plain click only pins the card, and Shift/Cmd/Ctrl-click toggles
  selection, as does the feature list's additive key (Shift with Enter or Space, and Shift-click on
  a row, as today).
- The host can refuse a pick before it shows (one kind per selection, a cap on the count). Today
  a host can only revert in `onselectionchange`, which flashes.
- A refused pick shows a short message saying why ("the limit was reached").

### My calls

- **Buttons:** a snippet the host passes (e.g. `card.actions`), given the card's feature (plugin
  id, ref, item) and whether it's selected, so the host can show Select or Remove. map-sdk lays
  them out in a row at the card's foot; the host renders the buttons themselves, in theme tokens.
- **The mode** is per plugin, alongside `selectionMode` (e.g. `PluginOptions.pickWith:
  "click" | "modifier"`, default `"click"`, today's behavior). The builder picks the name. With
  `"modifier"`:
  - a plain click or tap pins the card (the card must be on; the builder decides whether
    `"modifier"` without the card is an error or turns the card on);
  - Shift/Cmd/Ctrl-click toggles the feature in the selection (with `selectionMode: "multiple"`;
    with `"single"`, it selects or clears that one);
  - touch has no modifiers, so a tap only pins, and the card's Select button selects. Today's
    "a tap adds in multiple mode" rule (`interactions.svelte.ts`) doesn't apply in this mode;
  - the list's Enter on a row focuses it and shows its card; Shift+Enter toggles selection.
- **Refusing a pick:** a per-plugin hook called with the selection the pick would produce (and the
  ref), before anything changes, e.g. `PluginOptions.canSelect?(next, ref): true | string`.
  `true` lets it through. A string refuses it, and is the message to show (the host's own text,
  already in its language, since the host knows whether it was the cap or the kind). It covers
  clicks, list picks, and anything else that would call `onselectionchange`; `setSelection` from
  the host isn't checked.
- **Where the message shows:** a brief notice over the map (bottom center, above the credits),
  in theme tokens, with `role="status"` so screen readers announce it. It goes away after a few
  seconds or on the next pick; under reduced motion it appears and disappears without animation.
  The builder may place it in the selection bar instead, if that reads better, as long as it
  works with `selectionBar={false}`.

## 3. Focus area

### Decided

- For a given geometry: a two-tone outline (a line over a wider, lighter casing, so it reads on
  any basemap and over fills) and a faded surround outside it (an inverse mask), as on sjvair.com's
  pesticides and emissions explorers.
- A polygon is not clickable, not listed, not hovered, and drawn under the interactive layers.
- For a point (a school, "Your location"): an outlined ring with a label. The point pin, decided
  by the user on 2026-11-11 (a pin-only brainstorm after the main one):
  - **Shape:** the outlined ring (below), not the dashboard's teardrop pin.
  - **Listed and clickable:** the point is one row in the feature list, named by its label, and
    clicking the ring (or focusing its row) pins its card, which shows the label alone, as a
    feature with no reading does. It is never selectable. It draws under the data plugins, so a
    monitor at the same spot still takes the click. Since the row names the place, the label
    beside the ring is hidden from screen readers. A polygon stays unlisted: it is a boundary, not
    a place.
  - **Color:** the ring's stroke is `--focus-area`, not `--highlight`: a `--highlight` ring is
    what a selected monitor looks like with `selectedStyle: "ring"`.
- **Colors follow the theme** (the user, 2026-11-11), through three new family tokens:

  | Token                 | Falls back to                        | Used for                    |
  | --------------------- | ------------------------------------ | --------------------------- |
  | `--focus-area`        | `--foreground`                       | The line and the point ring |
  | `--focus-area-casing` | `--background`                       | The casing under the line   |
  | `--focus-area-wash`   | `--background`                       | The surround                |

  Not `--primary`: `--highlight` (selection) already falls back to it, so a focus area would look
  like a selection.

### From sjvair.com (`assets/js/pesticides/section-map.js`, `assets/js/emissions/facility-map.js`)

These are the starting values. The builder may tune them, and says so in the PR.

- Line 2.5px at 0.9 opacity, round joins; casing the line's width + 3px (5.5px) at 0.9 opacity.
- Surround: a world-covering polygon (`[-180, -85]` to `[180, 85]`) with each part's outer ring
  punched out (a region's own holes stay covered); fill at 0.55 opacity.
- The pesticides explorer also tints inside the area faintly (0.08). My call: leave the tint out;
  the theme line plus the fade outside is enough, and a tint would sit over the data.
- Point ring: 13px radius, 3px stroke, no fill (the emissions explorer's highlight pin), on a
  casing like the line's.

### My calls

- **Shape of the API:** a preset plugin (e.g. `focusAreaPlugin({ id, geometry, label? })`, with a
  way to change the geometry without re-adding it). For a polygon it is `hoverable: false` with no
  features, so it's never listed or clicked; for a point it lists one feature (the user's call,
  above), never selectable. Hosts add it at the bottom of the draw order (or `before` the first
  data plugin); the docs say so. The builder may make it a `MapContext` method instead if that
  fits the draw-order rules better; either way it lives in the registry like any plugin.
- **The label** of a point is the host's text, drawn beside the ring in `--foreground` with a
  `--background` halo. The builder picks a GL symbol layer (stays under the interactive layers) or
  a DOM overlay.
- **The point's label replaces the dashboard's own pin** (the user, 2026-11-11, through the
  coordinator). The widget's spec 1 labels its pin ("Your location", "Shared location", or a
  school's name) with its own MapTiler `Marker` (data-dashboard `step-5-spec-1`,
  `src/lib/widgets/map/pin-label.svelte.ts`), which costs it a direct `@maptiler/sdk` dependency.
  Part 3 covers everything that does, so the dashboard can drop both: a host-given text label
  beside the pin; theme tokens; hidden from screen readers when the feature list already names the
  place (a host option); and kept across detach and remount (`active` off and on, a basemap or
  theme change). Read that file before building part 3.
- Polygon and MultiPolygon geometries, and Point. Anything else throws a clear error.
- It reads colors with `themeColors` and re-reads them on a theme change like the other plugins.
- With `projection` set to globe, the world polygon must still cover the visible earth. The
  builder checks this in the demo.

## 4. Schools and child care

### Decided

- A preset on `pointsPlugin`, fed by sdk-js's locations. Types and labels come from metadata.
- **Pictogram markers** (the user, 2026-11-11): a small glyph in an outlined badge, so they can't
  be mistaken for monitors, which are circles and triangles. Squares were rejected: map-sdk
  exports a `square` marker and the monitor shape type allows one, so it's too close to a monitor.

### What exists (checked 2026-11-11)

- sdk-js has `getPesticideLocations` (`lib/pesticides/get_pesticide_locations.ts`) for
  `/api/2.0/pesticides/locations/`: a bbox (at most 12 degrees a side), a region, or a point and
  radius (at most 10 miles); optional `type` (`public_school`, `private_school`, `child_care`)
  and `county`. Each feature has `id`, `name`, `type`, `type_label`, `address`, `city`,
  `school_district`, `school_district_id`, `school_district_url`, `grade_span`, `enrollment`, and
  `capacity`.
- sdk-js's regions metadata (`getRegionsMeta`, `LocationTypeMeta`) lists location types with a
  `label`.
- So no sdk-js change is expected. If the builder finds one is needed, tell the coordinator, who
  arranges an sdk-js session; don't work around it here.

### My calls

- **Glyphs:** Lucide's `school` for public and private schools, and `baby` for child care
  (`backpack` if `baby` reads poorly at marker size). Lucide is ISC. Markers are SVG strings drawn
  into GL images, so map-sdk embeds the two path sets as strings with Lucide's license notice
  rather than adding `@lucide/svelte`; `test:licenses` must still pass.
- **Colors:** two new family tokens, `--school-marker` (fallback `#5a6b7b`, sjvair.com's slate) and
  `--child-care-marker` (fallback `#1c9099`, sjvair.com's teal), with the badge outlined like the
  other markers (`--swatch-outline-*` style, or the marker outline the points plugin already uses).
- **Public vs. private** share the school glyph and color; the type label (from metadata) tells
  them apart in the card, the list, and the legend.
- **Data:** presets never fetch, so a store does: e.g. `createSchoolsStore` in `./stores`, on
  `getPesticideLocations`, with two modes the host picks: a region (by its id) or following the
  view (a bbox padded by half a view, from zoom 9 up, as sjvair.com's explorer does, staying under
  the 12-degree cap). It exposes a `dataSource` like the other stores. The dashboard picks the
  call. `./stores` must stay off the map engine (`test:bundle`).
- **No point-and-radius mode.** The endpoint's `lat`/`lng` form puts the point in the URL, and
  sdk-js warns to use it only for public points, never a person's own location. The dashboard's
  place can be the user's location, so a public store API that takes any point would invite that
  leak. If a host later needs "schools within N miles of a school", add a mode that takes a
  school's id, not coordinates.
- **Labels from metadata:** the type labels come through the metadata provider from the regions
  metadata's location types. If the provider has no hook for that yet, the builder adds one
  (default: the SDK call), as for the other metadata.
- **Card:** name; type label; address and city; school district; grade span; enrollment (schools)
  or capacity (child care) when present. Every line a `mapsdk_*` message key.
- **Legend:** one entry per type, glyph and label.
- **Not selectable in map-sdk.** `SpatialSelection` is monitors or regions (the dashboard's
  shape), and the dashboard treats a school as a single place, not part of a selection. A school's
  card takes host buttons like any card (the dashboard's "use this place", for example), and
  `featureclick` gives the host the feature's id. Widening `SpatialSelection` with a location kind
  is out of scope. The dashboard may need the school's code rather than its id to resolve it as a
  place (`getLocationsByCode`); the locations feature has no code today, which is the dashboard's
  to raise with the coordinator if it needs it.
- **Default zoom range:** from zoom 9, as sjvair.com; the host can change it.

## 5. The options toolbar

### Decided

- **Looks and behaves like monitor-map 5.0's toolbar**: the same groups (Pollutant, Monitors,
  Layers, Overlays, Settings), rows, icons, and tints, which each option supplies. The toolbar's
  own surfaces (backgrounds, borders, focus ring) use theme tokens.
- **Two layouts, by the map's width, not the window's**:
  - wide: a row of joined dropdown buttons;
  - narrow: one options button that opens a panel covering the map, with each group as a section
    that expands (the user confirmed this picture for a ~300px tile).
- **The host declares the options; presets supply ready-made declarations** the host can use as
  they are, change, or leave out, and the host can add its own rows to a preset group or a group of
  its own.
- **The host owns the values.** The toolbar shows them and reports changes.
- **Phones and touch, keyboard, WCAG 2.2 AA**, using a standard pattern. My call, which the user
  agreed to: a disclosure (a button with `aria-expanded` that shows a panel of ordinary checkboxes,
  radios, and a select), not the ARIA menu pattern, which fits poorly with a select, partly
  checked group boxes, and help text.
- Hover opens a dropdown only with a mouse (wide layout), as on monitor-map's desktop.
- Message keys with English defaults.

### What monitor-map 5.0's toolbar does (all of it must be possible)

From `src/lib/options/` on monitor-map `release/5.0.0`:

- **Triggers:** an icon, a label, and a chevron; a trigger can show its icon only on the wide
  toolbar while the narrow panel still shows its label (Settings); a dropdown can align to the
  trigger's right edge (Overlays, Settings); a whole group can be disabled (Monitors while the
  pollutant is "None"); a trigger's label and icon can follow the current value (Pollutant shows
  the chosen pollutant's).
- **Groups:** the buttons are joined into clusters (Pollutant alone; Monitors, Layers, Overlays,
  Settings together).
- **Rows:**
  - radio rows with an icon, label, unit in small text, and help text under it (Pollutant;
    Settings' theme variants);
  - checkbox rows with an icon (Inactive, Inside, Collocation Sites, Fire & Smoke, Wind, Marker
    Clusters);
  - a checkbox whose sub-options show only while it's on or partly on (EV Chargers → Level 2,
    Level 3);
  - a select-all group: a checkbox that's checked, unchecked, or partly checked from its visible
    children, sets only its visible children, and hides when it has none (Reference-grade and
    Low-cost sensors, over monitor types);
  - a labeled select (Settings' basemap);
  - an action button (Reset Map Options);
  - separators between rows;
  - rows that appear only in some states (Collocation Sites only for PM2.5; monitor types only
    when they report the current pollutant).
- **Behavior, wide:** one dropdown open at a time; a click toggles it; hovering another trigger
  closes a click-opened dropdown; a click outside closes it; focus leaving the dropdown closes it;
  Esc closes it and returns focus to its trigger; picking a radio in the Pollutant dropdown closes
  it; dropdowns scroll when tall.
- **Behavior, narrow:** an "Open map options" button opens a panel titled "Map Options" with a
  close button; any number of sections can be open; picking a radio keeps the section open; the
  panel slides in (no slide under reduced motion).
- Crossing between the layouts closes everything and starts fresh.
- A `search` slot: shown last on the wide toolbar, beside the options button on the narrow one
  (monitor-map's place search).
- A basemap that fails to load shows as reverted (Settings reads `map.basemap.current`).

### What the dashboard's widget needs (from `data-dashboard-e9`, 2026-11-11)

Firm needs; anything about which rows the widget shows is for the dashboard's own spec 2:

- Pollutant choices come from the host (the widget passes the monitors metadata's
  `available_pollutants`), never a list in map-sdk.
- No theme row (the widget follows the dashboard's theme). Any subset of preset groups and rows,
  plus the host's own rows and groups.
- **One change event per user action, carrying the whole values object.** A select-all that flips
  several rows is one event, so it's one undo step. A list of the changed keys alongside it.
- **The host can set values at any time without a change event** (undo, redo, another tab), like
  `setSelection` vs. `onselectionchange`.
- **Reset, if offered, goes to the host's defaults**, and is one change event.
- **Read-only** (shows values, can't change them) and **hidden**.
- Several maps per page, each with its own toolbar and values; nothing page-wide.
- Layout from the map's box, including in the widget's fullscreen.
- Dropdowns and the panel stay inside the tile, which clips its contents.

### My calls

- **The value model:** a flat record keyed by option id (`Record<string, boolean | string>`; the
  builder may tighten the types). Each row's id is its key; a select-all group has no value of its
  own (it's computed from its children); a submenu's parent is an ordinary checkbox.
- **The API, roughly:** a component (e.g. `OptionsToolbar`) taking `declarations` (groups and their
  rows), `values`, `onchange(values, changedKeys)`, optional `defaults` (enables the Reset action
  and is what it resets to), `readonly`, and a `search` snippet. The host passes new values to show
  them, which never calls `onchange`. Not rendering it hides it. The builder picks names and
  whether `MapView` takes it as a prop or a snippet, as long as `MapView` can place it clear of the
  zoom controls and the List button.
- **Declarations are plain data plus snippets for icons** (a row's icon is a `Snippet`, or an SVG
  string for marker icons like `circle(...)`), and the host passes a new array to change them; the
  toolbar re-renders and keeps whatever is open. That's how "rows that appear only in some states"
  and "label follows the value" work: the host recomputes. Kinds: `radio` (with options: value,
  label, unit, help, icon), `checkbox` (optional `children`: shown while on or partly on),
  `group` (select-all over `children`), `select` (with options), `action` (the host's button; Reset
  is a built-in action that needs `defaults`), and `separator`. Group options: label, icon,
  `iconOnly`, `align: "end"`, `disabled`, and a `cluster` key so groups join into one button
  cluster.
- **Preset declarations** (e.g. `monitorsOptions(...)`, `hmsOptions(...)`, `schoolsOptions(...)`,
  `basemapOptions(map)`): functions returning declarations and default values, with labels from
  `mapsdk_*` keys and the metadata, and marker icons from map-sdk's own shapes. They don't carry
  Lucide icons for the group buttons; hosts pass those (monitor-map its own). They don't wire values
  to plugins: the host does that, since its options don't map one-to-one onto plugins (one Fire &
  Smoke checkbox for two plugins, one Marker Clusters for monitors and EV chargers, Pollutant
  "None"). The builder checks the monitors metadata has what the Pollutant and Monitors defaults
  need (pollutant labels, units, and help text; monitor type labels; which types report which
  pollutant). A gap goes to the coordinator for an SDK or server change, and the preset accepts the
  text from the host until then.
- **The breakpoint:** monitor-map's 48rem, measured on the map's box (a container query or the
  `ResizeObserver` `MapView` already has). monitor-map's behavior is unchanged, since its map fills
  the window.
- **Staying inside the tile:** a dropdown's height is capped by the space below its trigger inside
  the map, and it scrolls; it aligns to whichever edge keeps it inside the map. The narrow panel
  fills the map and scrolls. Both sit above every other overlay (list, legend, card).
- **Read-only:** the rows stay focusable and readable (`aria-disabled`, not `disabled`), so a
  keyboard or screen-reader user can still find out what's set. The triggers still open.
- **Every new UI string** is a `mapsdk_options_*` key with an English default (open and close
  buttons, panel title, group labels for the presets, "Reset Map Options"). Hosts' own labels are
  their own strings.
- **Per-instance ids** (`$props.id()`), so two toolbars never share an id or an open menu.
- **The basemap row stays host-owned.** `basemapOptions(map)` is plain data like the other
  presets; the host applies a change with `map.basemap.select`. When a basemap fails to load and
  map-sdk falls back, the toolbar sends one change event with the basemap it fell back to (its
  changed keys name the basemap row), so the host's saved value follows what the map shows. It's
  the one change event a user didn't make, and the docs say so. The builder adds whatever
  `BasemapState` needs to report the fallback.

## Testing

- Each part's specs follow the repo's projects: logic in `unit`/`client`, components in
  `browser` (real Chromium), and the demo in e2e (Chromium and Firefox locally, WebKit in CI).
- Part 1: the tap bug gets e2e coverage with touch emulation on all three engines; Esc, close
  button, click elsewhere, list focus, focus return, card following a pan, and card closing when its
  feature leaves the data.
- Part 2: modifier-click and list Shift+Enter toggling, tap-then-Select on touch, a refused pick
  (no flash: `onselectionchange` never called, message announced).
- Part 3: the mask's holes (Polygon, MultiPolygon, a region with holes), theme switch re-colors it,
  not listed or clickable.
- Part 4: the store's two modes and the 12-degree cap, labels from metadata, `test:bundle`, and
  `test:licenses`.
- Part 5: both layouts at a 300px map in a wide window and a full-window map; keyboard through every
  row kind; touch; read-only; one event per action, including select-all and reset; setting values
  fires nothing; two maps on one page; axe checks on both layouts.
- The demo gets each part (the card on, a "modifier" plugin with a cap, a focus area, schools, and
  the toolbar driving the demo's plugins).

## Docs

- README: each new prop, option, token (the token list), preset, and store; the "Changes" section
  for each release; examples kept in step with `tests/unit/readme-examples.test.ts`.
- map-sdk `CLAUDE.md`: the new pieces in the architecture overview.
- data-dashboard, on `step-5` (worktree `.worktrees/docs-map-sdk` from `origin/step-5`): map-sdk's
  status in `TODO.md` after each PR and release; the deferrals below in `DEFERRED.md`.
- Keep the coordinator told of each PR, release, and API change.

## Deferrals (to record in data-dashboard's `DEFERRED.md`)

- **A middle, icons-only toolbar layout** between wide and narrow. Why: two layouts are simpler to
  get right. Revisit when a tile width shows the wide layout cramped or wrapping badly.
- **The faint tint inside the focus area** (sjvair.com's pesticides explorer). Why: it sits over
  the data, and the line and fade suffice. Revisit if the user wants the explorers' exact look.

## Left to the builder

Names and exact shapes of every API above; the keyboard path into the card (within the rules
above); where the refused-pick message shows; a plugin or a `MapContext` method for the focus area;
GL symbol or DOM label for the point; the store's name and options; the starting values from
sjvair.com; and how the toolbar's CSS sizes (container query or measurement).
