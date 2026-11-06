# `@sjvair/map-sdk`: frameless Legend and a detail for unscaled features

Date: 2026-11-05. Status: **approved by the user 2026-11-06.**
Release 1, step 5 (data-dashboard `TODO.md` → "Release 1, step 5"). Two small, general options
monitor-map 5.0 asked for; the user put both in one PR, after the List button options (#5).

## Intent

monitor-map 5.0 keeps two pieces of today's map that map-sdk currently fights:

1. **Its folding "Legend" card** (info icon, "Legend", chevron, `aria-expanded`, bottom-left).
   map-sdk's `Legend` always draws its own card (`.mapsdk-legend` in `src/lib/ui/Legend.svelte`:
   border, background, padding, `width: 21rem`, radius, shadow), so monitor-map ends up with a box
   inside its box where today has one card.
2. **EV charging stations in the feature list** (the user's decision; monitor-map's own
   `pointsPlugin`, no scale). Every row and tooltip shows map-sdk's "No level" chip, so a
   station's Level 2 and Level 3 chargers look the same.

**The user's decisions (2026-11-05):** both are in scope, in one follow-up PR after #5. The
legend option is `framed?: boolean` (default `true`), as monitor-map proposed. The detail
replaces "No level" in the list and in map-sdk's own tooltips (monitor-map asked for the
tooltips too, so the list, hover and focus read the same, and it can drop its custom EV tooltip).

Both options are general: the dashboard's Map widget and any other host get today's look by
default.

## Goals

1. `Legend` takes `framed?: boolean`, default `true` (today's card). With `false` it draws no
   frame: no border, background, padding, radius, shadow, or fixed width. Everything inside
   stays: the sections, bars, status lines, retry button, theme handling, `order`, the region's
   accessible name, and hiding itself when empty. The host's card supplies the frame.
2. `FeatureListItem` gets an optional `detail?: string`: a short text about a feature that has
   no level (e.g. "Level 2 charger"). Where map-sdk would show "No level" for that feature, it
   shows the detail instead:
   - **Feature list row:** the detail as plain text in the level chip's place, with no swatch.
   - **The row's accessible name:** the detail in the level's place, e.g. "Fresno Station,
     Level 2 charger". With a `null` value (EV rows), no "no reading": just name and detail.
   - **map-sdk's generic tooltip** (`TooltipItem`, used by hover, pinned and list-focus
     tooltips): the detail as plain text in the chip's place, with no chip.
3. `pointsPlugin` takes `detail?(props: P): string | undefined`, feeding `FeatureListItem.detail`
   for each feature. Ignored when the feature has a level (see below).

## Non-goals

- Changing the monitor, cluster or collocation tooltips (they have scales).
- A collapsible header in `Legend` (monitor-map owns its folding card).
- The view summary (screen-reader live line): a plugin without a scale already reads as a plain
  count ("12 EV stations"), so nothing changes there.
- Changes to monitor-map, the dashboard, sdk-js, or sjvair.com. Publishing.

## Anti-goals

- Any change to a plugin with a scale, or to `Legend` with no options.
- A detail shown as if it were a level (a swatch or a chip outline that suggests a color
  meaning).
- Hardcoded strings: the detail text is the host's (it localizes it); map-sdk's own new words,
  if any, are `mapsdk_*` message keys.

## Rules (my calls, marked)

- **A level wins over a detail** (my call): `detail` only replaces the "No level" fallback. An
  item with a real level shows its level as today, so a detail can't hide a level.
- **Plain text, not a chip** (my call): in the list, the detail sits where the chip's label sits,
  in the same `text-xs` size and color as the level label, with no swatch; in the tooltip, a plain line where the chip was.
- **Accessible name** (my call): one new message key, `mapsdk_list_row_detail`:
  `"{name}, {detail}"`, for a `null` value with a detail. A non-null value with a detail uses the
  existing row keys with the detail in the `{level}` slot.
- **Sorting** is unchanged: a `null` value sorts last; a detail doesn't affect order.
- **Frameless legend layout** (my call): it keeps the vertical gap between sections and
  `pointer-events: auto`, and takes the width its container gives it. Its text color still
  comes from `--foreground`.

- **What a frameless legend's swatches blend over** (my call): today `Legend` reads its own
  computed background (`resolveBackground(root)`) and `LegendBar` blends translucent swatches
  over it. A frameless root is transparent, which would blend them over black. With
  `framed={false}`, it reads the nearest ancestor with an opaque background instead (the host's
  card; monitor-map's is white today), falling back to the `--background` token, re-read on each
  theme change as now.

## Tests

- **Legend** (browser): with `framed={false}` the root has no border, padding, background or box
  shadow and no fixed width (it fills a 300px container); sections and status lines still
  render; inside a container with an opaque background color, a translucent swatch is blended
  over that color, not black. Default unchanged (21rem, border).
- **Feature list** (browser + unit for `rowLabel`): a row with `level: NO_LEVEL` and `detail`
  shows the detail and no swatch and no "No level"; its accessible name is "Name, detail"; a row
  with a level and a detail shows the level; a row without a detail still shows "No level".
- **Tooltip** (browser): `TooltipItem` with a detail shows it with no chip; with a level, the
  chip as today.
- **pointsPlugin** (client): `detail` feeds `features()`; without the option, no `detail`.
- README (the `Legend` and `pointsPlugin` docs, `FeatureListItem`), `readme-examples` test,
  `CLAUDE.md`, `en.json`; `check`, `lint`, `test`, `test:bundle` pass.
- Screenshots: the demo's setup map with a frameless legend inside a sample card, and a list
  with detail rows (a small demo toggle, off by default; my call).

## Left to the builder

- Class names and how the frameless variant is expressed in CSS.
- The demo's sample card and detail rows.
