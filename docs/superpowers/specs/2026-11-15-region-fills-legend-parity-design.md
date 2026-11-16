# Region fills with no-figure regions, a shared Legend section, and three parity fixes

Date: 2026-11-15. Ships as `@sjvair/map-sdk` `0.1.0-beta.15`.

## Why

The dashboard's Map tile fills one region type (counties, ZIPs, census tracts, ...) by each day's
level, drawn under the monitors, through `regionsPlugin`. Today that look has three gaps, and the
user chose a map-sdk change over accepting it (2026-11-15):

1. A region with no figure is painted grey at the fill's opacity (`shapesPlugin`'s choropleth
   `fill-color` falls back to `theme.neutral`), which reads like a figure.
2. `regionsPlugin` passes only `id`, `source`, `layerLabel` and `selectable` to `shapesPlugin`.
3. The Legend draws a section per plugin with a scale, so monitors plus a fill of the same
   pollutant show the same scale twice.

The same beta carries three fixes from the user's monitor-map 5.0 parity review (2026-11-15):

4. On a phone-width map, the engine's compact attribution starts expanded and covers the legend.
5. An options checkbox row with children has no chevron (monitor-map's EV Chargers).
6. On the narrow toolbar, a host's search field has no documented way to know the room beside the
   options button, so monitor-map's field wraps to a second row.

## Goals, non-goals, anti-goals

- Goals: no-figure regions drawn as an outline with no fill, by option; `regionsPlugin` passing
  the shape options through; one Legend section per shared metadata scale with a "No data" row;
  the attribution folded at the start on narrow maps; the chevron on checkbox rows with children;
  a definite-width search slot on the narrow bar.
- Non-goals: the wide toolbar's search slot; any change to how scales resolve or are compared for
  drawing; the dashboard's or monitor-map's own code.
- Anti-goals: any visible change for a caller that sets nothing new (monitor-map 5.0 and the
  dashboard), except the three parity fixes, which every host gets: the folded attribution, the
  chevron, and the narrow search slot's width. A shared Legend section needs no opt-in either: it
  appears whenever two plugins' sources carry equal `ScaleRef`s (no current caller does). Meaning by colour alone. Credits that can't be
  reached by touch or keyboard.

## Decisions (the user's, 2026-11-15)

- **Same scale** means the same metadata reference: the sources' `ScaleRef`s have the same
  `dataset` and `entryType`. A literal `Scale` passed by the host never shares a section. (Rejected:
  the same `Scale.id`, which could merge two pollutants that use one scale.)
- **No-figure label**: "No data", message key `mapsdk_legend_no_figure`.
- **Attribution**: start folded on narrow maps (rejected: a documented stacking rule that each host
  must follow).
- **Search**: on the narrow bar the search slot fills the rest of the bar (rejected: a measured CSS
  variable, which can lag a frame behind a resize).

## Approaches

For each part there was one approach that fits; the alternatives considered:

- No-figure fill: the fill layer's opacity goes to 0 where a feature has no level (chosen), vs. a
  separate filtered layer for no-figure features (more layers and draw-order risk, no gain).
- Shared section: grouping in `Legend.svelte`, the only place that sees every plugin (chosen), vs.
  plugins knowing about each other (couples plugins).
- Attribution and search: see Decisions.

## Design

### 1. `shapesPlugin`: `noFigure`

- New option `noFigure?: "neutral" | "outline"`, default `"neutral"` (today's look). Choropleth
  only; ignored in plain mode.
- **No figure** means the feature has no level on the scale: the same rule as the list's
  "No level" (`levelFor(value, scale) === NO_LEVEL`; on the map, `levelKeyExpression(scale,
  "value")` is `""`). Map, list and legend agree on it.
- Under `"outline"`:
  - The fill layer's `fill-opacity` is 0 for a no-figure feature (wrap today's opacity in a `case`
    on the level key).
  - A no-figure feature's outline is the theme's `--foreground` line at `OUTLINE_WIDTH`, whatever
    `outline` is: with `outline: "theme"` that is today's line; with `outline: "level"` the
    level-coloured line falls back to `--foreground` (and full opacity) instead of neutral; with
    `outline: "none"`, an extra line layer filtered to no-figure features draws it, so they stay
    visible. LineString geometries are unaffected.
  - Selection (ring and check) and clicks work on no-figure features as today: a transparent fill
    still takes clicks in MapLibre, so hover and click hit the whole polygon.
- The plugin's legend data reports `noFigure: true` while `noFigure` is `"outline"` and at least
  one loaded feature has no figure (see 3).

### 2. `regionsPlugin` passes options through

`RegionsPluginOptions` gains `noFigure?`, `fillOpacity?` and `outline?`, with `shapesPlugin`'s
types and defaults (`"neutral"`, 0.6, `"theme"`), passed straight through. `mode` stays
`"choropleth"`.

### 3. Legend: one section per shared scale, and the "No data" row

- `LegendData`'s scale form gains optional fields:
  - `scaleRef?: ScaleRef` — set by `createScaleResolver` when the source's scale is a `ScaleRef`;
    absent for a literal `Scale`.
  - `scaleLabel?: string` — the entry type's label from the metadata once known (the resolver
    already fetches it for precision), for titling a shared section.
  - `noFigure?: boolean` — the plugin draws at least one no-figure feature as an outline.
- `Legend.svelte` builds the entries as today, then groups scale entries whose `scaleRef` matches
  (same `dataset` and `entryType`). Each group is one section at the place of its first member in
  `order`; the other members' places close up. Status and symbols entries never group.
- A shared section (two or more members) is titled with the first member's `scaleLabel` that is
  set, else the first member's title. A one-member section keeps its own title, exactly as today.
  Units, bar and `display` come from the first member (same reference, same scale).
- The "No data" row: when any member has `noFigure`, the section ends with a row (like a
  `symbols` row) of a small swatch drawn as an outline only (a `--foreground` border, no fill,
  matching the map) and the text "No data" (`mapsdk_legend_no_figure`). The swatch is decorative;
  the text carries the meaning.
- Keyed by the first member's `pluginId`. axe passes on the Legend with a shared section and the
  row.
- `collocationSitesPlugin` already drops its scale section (it shares the monitors'); unchanged.

### 4. Attribution starts folded on narrow maps

- Cause: MapLibre 5.24's `AttributionControl._updateCompact` adds `maplibregl-compact` and
  `maplibregl-compact-show` (open) the first time the control goes compact (map ≤ 640 px wide,
  non-empty credits); only a map `drag` folds it. map-sdk's `setDataCredits` replaces the control
  whenever the data credits change, and each new control opens again, even after a drag folded
  the old one. Nothing in map-sdk's attribution code changed since 2026-11-04; the 2026-11-11
  folded start couldn't be reproduced from the code (probably the map measured wider than 640 px
  at first, or credits arrived in another order).
- Fix, in `create-gl-map.ts`: whenever the control becomes compact and shown without the user
  asking (after it is added, when its credits fill in, and after each `setDataCredits`
  replacement), remove `maplibregl-compact-show`, leaving it folded. A user's tap or keyboard
  press on the ⓘ button still opens it, and map-sdk never folds it again after that until the
  next drag (MapLibre's own rule). Wide maps (full attribution) are unchanged.
- **A credits change keeps the user's choice** (the user's decision, 2026-11-15). map-sdk
  remembers, per map, whether the person opened the compact credits; a `drag` (which folds them,
  MapLibre's rule) or the person closing them clears it. When `setDataCredits` replaces the
  control, the new one starts open if the person had it open, else folded. Carrying the state
  means setting both `maplibregl-compact-show` and the `<details>` `open` attribute the way
  MapLibre's own toggle leaves them. Browser specs cover both: a credits change while folded stays
  folded, and while opened stays open.
- How to detect "became compact" is the builder's call (e.g. watch the container's class with a
  `MutationObserver`, or fold after `_updateCompact` runs on `load`/`resize`/`styledata`); it must
  not depend on MapLibre internals beyond the documented class names, since `@maptiler/sdk` is
  pinned `~4.2.0` but MapLibre's patch versions move.
- Credits stay reachable: the ⓘ button is keyboard-focusable and operable, and opens the full
  credits.

### 5. Chevron on checkbox rows with children

In `OptionRows.svelte`, a `kind: "checkbox"` row with `children` draws the same
`.mapsdk-option-chevron` (with `mapsdk-option-chevron-closed` while off) as a `group` row: right
while off, down while on. Children still show only while on. Rows without children are unchanged.
Decorative (the checkbox carries the state), as on group rows.

### 6. Narrow toolbar: the search slot fills the rest of the bar

- On the narrow layout only, `.mapsdk-options-search` is `flex: 1 1 0; min-width: 0`, so it gets
  a definite width: the bar's width less the options button and the gap.
- Its empty part lets the pointer through to the map: the slot is `pointer-events: none` and its
  children `pointer-events: auto` (today the bar gives every direct child `auto`).
- README documents it: on the narrow bar the search slot has a definite width, so a field can
  cap itself with `max-width: 100%` (`max-w-full`) beside its own maximum.
- The wide bar is unchanged.

## Messages

- `mapsdk_legend_no_figure`: "No data".

## Public API changes (README "Changes", examples test, CLAUDE.md lines)

- `ShapesOptions.noFigure?: "neutral" | "outline"` (default `"neutral"`).
- `RegionsPluginOptions.noFigure?`, `.fillOpacity?` (0.6), `.outline?` (`"theme"`).
- `LegendData` scale form: `scaleRef?`, `scaleLabel?`, `noFigure?`.
- Legend: shared sections; the "No data" row. The README entry says plainly that sections share
  only when each member's data source has a `ScaleRef` as its `scale` (hosts don't build
  `LegendData`; the plugins fill `scaleRef` in from the source). If one member's source has a
  literal `Scale`, the Legend shows two sections, as today.
- Attribution folded at the start on narrow maps.
- Checkbox rows with children: chevron.
- Narrow toolbar: the search slot's definite width.
- No exports removed or renamed; no new theme tokens.

## Testing

TDD. Unit/client specs for the layer paint (`noFigure` × `outline` modes), `regionsPlugin`'s
pass-through, the resolver's `scaleRef`/`scaleLabel`, and the Legend grouping (same ref merges,
different ref or literal scale doesn't, order, titles, the row's condition). Browser specs for the
Legend (shared section, row, axe), the chevron, the narrow search slot's width and pointer
pass-through, and the attribution folded on a narrow map (and after a credits change), opening by
keyboard. e2e: the demo at phone width with the attribution folded.

## Left to the builder

- How the attribution fold detects the compact state (see 4).
- The "No data" swatch's exact size and line width, within the Legend's existing swatch look.
- Where the grouping helper lives (`legend-data.ts` is the natural home).
