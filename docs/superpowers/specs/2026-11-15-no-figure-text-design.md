# "No data" for no-figure regions in the list, tooltip and summary

Date: 2026-11-15. Ships as `@sjvair/map-sdk` `0.1.0-beta.16`.

## Why

`0.1.0-beta.15` draws a region with no figure as an unfilled outline under `noFigure: "outline"`,
and the Legend labels it "No data" (`mapsdk_legend_no_figure`). The feature list, the generic
tooltip and the view summary still say "No level" for the same region, because nothing on its
`FeatureListItem` says it is drawn as a no-figure outline. The dashboard works around it by
wrapping `regionsPlugin`'s `features()`.

## Goals, non-goals, anti-goals

- Goals: wherever an outlined no-figure item says "No level" today, it says "No data". The list row
  shows the Legend's unfilled swatch.
- Non-goals: a plugin option, a host-set text, new message keys or tokens, and the preset tooltips
  (monitor, cluster, collocation, fire), which list no shapes.
- Anti-goals: any change for a caller that leaves `noFigure` at `"neutral"` (monitor-map 5.0, every
  current caller). Meaning by colour alone.

## Decisions (the user's, 2026-11-15)

- **Option B:** no new plugin option. The "No data" text follows from `noFigure: "outline"`.
- **Mechanism:** a new optional field on the exported `FeatureListItem`,
  `noFigure?: boolean`. It means "drawn as a no-figure outline" and is ignored when the item has a
  level. `shapesPlugin` sets it; a host's own plugin may set it too. (Rejected: filling `detail`,
  which needs messages in `features()`, turns the row into a detail row, and collides with a
  host's wrapper.)
- **Which items:** the features the map draws as no-figure outlines: choropleth,
  `noFigure: "outline"`, a scale the layers are built with, a geometry that isn't a LineString or
  MultiLineString, and no level for its value. It's the same predicate (`drawnAsNoFigure`) as
  `legend()`'s "No data" row. Lines keep "No level". A source with no scale (`scale: null`) draws
  every polygon as an outline, so every polygon gets "No data", though the legend has no section
  then (the user's choice after review, 2026-11-15). While the scale is unavailable nothing is
  drawn and nothing is flagged.
- **Accessible name:** an outlined row with no value is "Fresno, No data"
  (`mapsdk_list_row_level`), not "Fresno, no reading". With a value, it's
  "Fresno, 5 µg/m³, No data".
- **View summary:** outlined items are counted as "N No data", after the levels. Items with no
  level that aren't outlined are counted as "N No level", after that.
- **Swatch:** the list row's swatch for an outlined item is unfilled (transparent, its usual
  `--foreground` outline), like the Legend's "No data" swatch. Same dot shape and size as the
  other rows.

## Design

- `FeatureListItem.noFigure?: boolean` in `core/plugin.ts`, documented beside `detail`.
- `levelText` (`ui/feature-list.ts`): order level → `noFigure` → `detail` → "No level".
  `noFigure` returns `{ kind: "none", text: messages("mapsdk_legend_no_figure") }`. A level still
  wins, and `noReading` still omits.
  `noFigure` comes before `detail` because a no-figure outline is what the map shows. `shapesPlugin`
  never sets both.
- `rowLabel`: a no-value item with `noFigure` (and no level) uses `mapsdk_list_row_level` with the
  "No data" text.
- `TooltipItem` needs no change: it renders `levelText` in the neutral chip, so it reads "No data".
- `summaryText` (`ui/view-summary.ts`): a separate count of `noFigure` items without a shown level,
  labelled `mapsdk_legend_no_figure`.
- `FeatureList.svelte`: the swatch gets class `nofigure` (transparent background) when the item
  has `noFigure` and no shown level.
- `shapesPlugin.features()` sets `noFigure: true` on the items the rule above covers, and omits
  the key otherwise.

## Testing

- Unit tests for `levelText`, `rowLabel` and `summaryText`, with and without `noFigure`, including
  that a level's label wins.
- Client tests for `shapesPlugin.features()`: outlined polygons get `noFigure`; lines, items with a
  level, `"neutral"`/unset, plain mode and an unresolved scale don't.
- Browser tests: the list row text, its accessible name and its unfilled swatch; the tooltip text;
  axe on both.
- Each new test is first shown to fail with the code under test undone.
