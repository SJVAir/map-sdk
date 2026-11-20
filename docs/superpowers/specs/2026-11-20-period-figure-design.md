# The period figure: SDK 5.0.0-beta.15, the monitors legend line, a no-figure region's label and reason

Date: 2026-11-20. Ships as `@sjvair/map-sdk` `0.1.0-beta.22`.

## Why

The dashboard's step 5 spec 6a colours monthly and yearly Maps with each pollutant's period
figure (on monthly and coarser summaries, the average of the daily figures). Its spec says the
Map's legend names that figure, e.g. "Average of daily highest 1-hour averages", from
`@sjvair/sdk` `5.0.0-beta.15`'s `period_statistic_label`. map-sdk can't do this today:

- `monitorsPlugin` passes neither `legendUnits` nor `legendNote` to `pointsPlugin`, so a host
  can't add a line to the monitors legend section. `figureLabel` shows in the tooltips only.
- `regionsPlugin` has no per-feature reason, so a region with no period figure reads only
  "No data". "No data" is also wrong for that region: it has data, just too few days of it. The
  dashboard's own calendar already tells "Not enough data" apart from "No data".
- `@sjvair/sdk` `5.0.0-beta.15` adds two required `Scale` keys, so map-sdk's literal `NO_SCALE`
  fails `npm run check` against it.

This closes data-dashboard `DEFERRED.md`'s "map-sdk: list the two new `Scale` keys in
`NO_SCALE`" and "The Map's legend doesn't name the month or year figure", and (the user's yes,
2026-11-20) part of "map-sdk's demo page doesn't show the newer opt-in features".

## Goals, non-goals, anti-goals

- Goals:
  - map-sdk builds and type-checks against `@sjvair/sdk` `5.0.0-beta.15`.
  - A host can put its own line (the figure's name) in the monitors legend section.
  - A host can name a region layer's no-figure state ("Not enough data") and give each no-figure
    region a reason ("Only 3 of 30 days had a figure"), shown everywhere "No data" shows today.
  - The demo shows all three new options.
- Non-goals: map-sdk choosing the figure's name or the label for any pollutant or resolution
  (metadata and the host decide; map-sdk draws what it's given). A label per region (rejected, see
  Approaches). The demo's older opt-in features (the rest of that DEFERRED entry). The lens's
  township flash (its DEFERRED entry waits on the user's hand check).
- Anti-goals: any change for a host that sets none of the new options (monitor-map 5.0, mobile,
  and the dashboard until it opts in), apart from the new message key below. `figureLabel`
  appearing in the legend on its own (the dashboard sets it at Daily, and its Daily legend would
  change unasked). Meaning by colour alone.

## Approaches

### The figure's name in the monitors legend

- **Pass `legendUnits` / `legendNote` through `monitorsPlugin`** (chosen, the user's yes
  2026-11-20). The same two options `pointsPlugin` and `shapesPlugin` already take, through
  `hostLegend`. The host writes the line (e.g. its own message joining the units and the figure's
  name). Opt-in, general, no new mechanism.
- Show `figureLabel` in the legend section: rejected, as it isn't opt-in (see Anti-goals).
- Both: rejected for the same reason.

### A no-figure region's reason

- **`detail(props)` on `shapesPlugin`, passed through by `regionsPlugin`, drawn by the shared UI**
  (chosen). The item carries `noFigure` and `detail`, and `levelText`, `rowLabel` and
  `TooltipItem` draw both. It reaches every place the item shows.
- A region-only tooltip snippet: rejected. It never reaches the list row or its accessible name.

### What "No data" becomes, and where the reason goes

- The reason replaces "No data" (like monitors' `detail` replaces "No level"): rejected by the
  user (2026-11-20), since the row no longer matches the legend's row.
- **The label stays and the reason sits beside it** (chosen, the user's option B, 2026-11-20).
- **One label per layer** (chosen, the user, 2026-11-20): a `noFigureLabel` string replaces
  "No data" for the whole layer, legend row included. The reason says which case a region is
  ("Only 3 of 30 days had a figure", or the host's text for a region with no row at all). The
  legend keeps one swatch with one meaning. Rejected: a label per region, which puts two legend
  rows with the same unfilled swatch.
- **The list row shows the label, not the reason** (the user, 2026-11-20, option (i)). Rows have a
  fixed height, so a long reason would be cut off; the reason goes in the row's accessible name,
  the tooltip and the pinned card.

## The design

### 1. The SDK move

- devDependencies: `"@sjvair/sdk": "npm:@jsr/sjvair__sdk@5.0.0-beta.15"`, exact.
- **The peer range stays `^5.0.0-beta.2`** (the user's yes, 2026-11-20): nothing in map-sdk needs
  beta.15 at runtime, so hosts on older SDK betas can still install this beta.
- `period_statistic: null` and `period_statistic_label: null` after `daily_statistic_label` in
  `NO_SCALE` (`src/lib/plugins/scale-resolution.svelte.ts`), `tests/fixtures/scales.ts` and
  `demo/pesticide-data.ts`, and any other literal `Scale` that `npm run check` finds.

### 2. `monitorsPlugin`'s `legendUnits` and `legendNote`

- `MonitorsPluginOptions` gains `legendUnits?: string` and `legendNote?: Snippet`, documented as
  in `pointsPlugin`, passed straight to it.
- Unset: no change. Set: the monitors section's units line replaces "(units)", and the note sits at
  the foot, as for every other plugin.
- With no scale (a `null` source scale) there is no legend section, so neither shows. While the
  scale is unavailable, the note shows under the status line (`hostLegend`'s rule).
- A shared section (equal `ScaleRef`s, e.g. the dashboard's region fill and monitors on one
  pollutant) takes the first member's units line and note that are set, as today. So the figure's
  name shows for both layers, which is right when both are coloured by the same figure.
- My call: `regionsPlugin` passes `legendUnits` / `legendNote` through too, so a region fill shown
  without monitors can name its figure. The same two lines; opt-in.

### 3. A no-figure region's label and reason

New options:

- `shapesPlugin`: `detail?(props: P): string | undefined` (trimmed; empty means none; ignored for
  a feature with a level), the same as `pointsPlugin`'s, and `noFigureLabel?: string`
  (already-translated; trimmed; empty means unset).
- `regionsPlugin`: passes both through.

`noFigureLabel` only applies where there is a no-figure state: `noFigure: "outline"`. Under
`"neutral"` (no no-figure items, no legend row) it's ignored. `detail` works under either:

- **`noFigure: "outline"`, a no-figure region** (the dashboard's case):

  | Where | Unset (today) | `noFigureLabel` | `noFigureLabel` and `detail` |
  | --- | --- | --- | --- |
  | Legend row | ▢ No data | ▢ Not enough data | ▢ Not enough data |
  | List row (visible) | ▢ No data | ▢ Not enough data | ▢ Not enough data |
  | Row's accessible name | Fresno, No data | Fresno, Not enough data | Fresno, Not enough data, Only 3 of 30 days had a figure |
  | Tooltip and card | "No data" chip | "Not enough data" chip | the chip, and the reason under it |
  | ViewSummary | 3 No data | 3 Not enough data | 3 Not enough data |

  `detail` without `noFigureLabel` works the same with "No data" as the label.
- **`noFigure: "neutral"`, a region with no level:** `detail` replaces "No level" in the row,
  its accessible name (`mapsdk_list_row_detail`) and the tooltip, exactly as a monitor's `detail`
  does today.

Where the pieces go:

- `FeatureListItem` (`core/plugin.ts`) gains `noFigureLabel?: string`, used with `noFigure`; its
  `detail` doc changes to say it sits beside the label on a `noFigure` item instead of being
  ignored. `shapesPlugin`'s `features()` sets `detail` on every item without a level when
  `options.detail` gives one, and `noFigureLabel` on `noFigure` items.
- `levelText` (`ui/feature-list.ts`): a `noFigure` item's text is its `noFigureLabel` else
  "No data", and the result also carries the item's `detail` for the tooltip and the accessible
  name. The exact return shape is the builder's.
- `rowLabel`: a `noFigure` row with no value and a detail uses the new key
  `mapsdk_list_row_level_detail`, `"{name}, {level}, {detail}"`. Without a detail it's as today
  (`mapsdk_list_row_level`).
- `TooltipItem`: a `noFigure` item shows the chip with its label, then the detail in the same
  `mapsdk-tooltip-detail` style under it. The pinned card shows the same `TooltipItem`.
- `summaryText` (`ui/view-summary.ts`): no-figure items are counted under their `noFigureLabel`
  else "No data".
- `LegendData`'s scale variant gains `noFigureLabel?: string`; `shapesPlugin`'s `legend()` sets
  it with `noFigure`. `legend-data.ts` carries it onto the section, a shared section taking the
  first member's that's set (as for `unitsLine` and `note`), and `Legend.svelte` draws it in place
  of "No data".
- My call: a `noFigure` item **with** a value (a value on no level, rare) keeps today's accessible
  name ("Fresno, 5 µg/m³, Not enough data"); its detail shows in the tooltip and card only, so no
  second new key is needed.

### 4. The demo

The demo's Counties preset turns on `noFigure: "outline"`, `noFigureLabel`, a `detail` for its
no-figure counties, and a legend line; the Monitors preset gets a `legendUnits` line naming a
figure. Demo text is the demo's own (the demo isn't shipped, so it needs no message keys). How
the demo gets counties with no figure, and the exact demo wording, is the builder's call; e2e can
then check the label, the reason in the tooltip, and the legend line.

## What changes for hosts

- New optional API only: `MonitorsPluginOptions.legendUnits` / `legendNote`,
  `RegionsPluginOptions.detail` / `noFigureLabel` / `legendUnits` / `legendNote`,
  `ShapesOptions.detail` / `noFigureLabel`, `FeatureListItem.noFigureLabel`,
  `LegendData.noFigureLabel`.
- **One new message key, `mapsdk_list_row_level_detail`.** A host that types its messages as
  `Record<MessageKey, …>` must add it when it moves to this beta. The README's "Changes" says so.
- `@sjvair/sdk` peer range unchanged (`^5.0.0-beta.2`).

## Tests

TDD; each new test is shown to fail with its code undone. Unit specs for `levelText`, `rowLabel`
and `summaryText` with a label and a detail; `shapesPlugin`'s items and `legend()` with the two
options (a real scale, and the `null` scale case: items still flagged, no legend section);
`shareSections` taking the first `noFigureLabel`; `monitorsPlugin` passing `legendUnits` /
`legendNote` through to a drawn legend section (a real scale), and a section shared with a region
fill. Browser specs: the Legend's row label, the tooltip's chip with the reason under it, and the
list row's accessible name, with axe on each root. e2e on the demo: the label, the tooltip reason
and the monitors legend line. Guards: every option unset gives today's output.

## Docs

README: the new options in the monitors, regions and shapes sections, the "Changes" entry for
`0.1.0-beta.22` (every new key and the new message key), the README examples test; CLAUDE.md's
architecture lines; the version bump in the same PR.

## Left to the builder

The `levelText` return shape, the demo's data and wording, test file placement.
