# Parity defaults: date format, cluster area, fire box, smoke hover — design

Date: 2026-11-07. Branch `feat/parity-defaults` from `origin/main` (8f6d7c7, `0.1.0-beta.3`).

## Why

monitor-map 5.0's parity review (session `monitor-map-2a`, comparing 5.0 on map-sdk
`0.1.0-beta.2` against monitor-map 4.3.0 on sjvair.com) found four tooltip behaviors the user wants
changed. All four are **default changes, not opt-ins**: every map on map-sdk gets them,
monitor-map 5.0 and the dashboard's Map widget included. They ship in a beta after `0.1.0-beta.3`
(already on npm's `next`).

"Old map" below means monitor-map 4.3.0 (`git -C ../monitor-map show 0129e04:<path>`).
Screenshots: `monitor-map/compare-5.0/` and `monitor-map/compare-5.0.html`.

## Goals

1. Times in tooltips read like the old map's, in Pacific time.
2. The monitor cluster tooltip says how spread out its monitors are, with honest wording.
3. Fire tooltips use the monitors' reading box.
4. Smoke plumes show no tooltip on hover.

## Non-goals and anti-goals

- No new options for hosts to turn any of this off (all defaults).
- Not a copy of the old map where the old map was wrong: the "2:58:pm" colon, local-time display,
  the "covering" wording, and the leaf-order polygon area are all deliberately not copied.
- No fire detection time in the fire tooltip (it would read as "started at" or "still burning at";
  the satellite only saw heat during one pass).
- The chart's date format belongs to monitor-map, not this work.
- Anti-goal: a plume, which can cover half the map, must never hide another layer's hover tooltip.

## 1. Date-time format

`createDefaultFormat().dateTime` (`src/lib/data/format.ts`) formats in `America/Los_Angeles` as
date-fns would with `h:mm aaa EEEE MMM dd, yyyy`: **"4:00 pm Friday Nov 06, 2026"**
(for `2026-11-07T00:00:00Z`).

- Hour unpadded; minutes two digits; lowercase "am"/"pm" (never "PM"); a space, not a colon, before
  it; full weekday; short month; day zero-padded ("Nov 06"); four-digit year; no comma after the
  weekday. Noon "12:00 pm", midnight "12:00 am".
- Always Pacific, including on both sides of a daylight-saving change.
- **Zone suffix (user, 2026-11-07): keep it.** On a device outside Pacific, callers still append
  " PT" through `zoneLabel()` and `mapsdk_time_with_zone`: "4:00 pm Friday Nov 06, 2026 PT". On a
  Pacific device there is no suffix. Reason: an unlabeled time is ambiguous; Pacific matches the
  rest of the product (hourly averages, chart days, forecast days); "Last updated N minutes ago"
  already covers freshness without conversion.
- Applies to every caller of `format.dateTime`: today `MonitorTooltip.svelte` and
  `CollocationTooltip.svelte` (re-grep when building).
- Left to the builder: whether to use date-fns with a time-zone helper or `Intl` `formatToParts`
  assembled to this pattern. Prefer `Intl` (no new dependency); if a dependency is added it must
  pass the license rule and `test:bundle` (`./data` must stay off the map engine).

## 2. Cluster tooltip area line

The count line of `MonitorClusterTooltip.svelte` becomes **"3 monitors within a 22.619 mi² area"**.

- **Wording (user, 2026-11-07):** "within … area", not the old map's "covering" (a monitor reads
  the air at its point; it doesn't cover a region) and not "region" (clashes with the Regions
  layer). Space before "mi²" (my call; the old map had none).
- **Area method (user, 2026-11-07): convex hull** of every leaf's coordinates
  (`cluster.leaves()`, which already returns `lngLat`), monitors without a reading included. Not
  the old map's leaf-order polygon, which can cross itself, undercounts, and changes with data
  order; "within" is only true of a shape that contains every monitor. For 3 monitors the hull and
  the old triangle give the same number.
- Area via `@turf/area` (MIT; new dependency, same family as the `@turf` packages already used) on
  the hull polygon, square metres to square miles with `@turf/helpers`'
  `convertArea(m2, "meters", "miles")`, then `.toFixed(3)`. Hull via `@turf/convex` or a small
  local hull (builder's call; license rule and bundle checks apply).
- **No area line part** when the area, formatted to 3 decimals, is "0.000" (2 monitors, all on one
  spot, all collinear, or a few metres apart; the check is on the formatted number, since
  `@turf/area` can give a tiny non-zero value for points on a lng/lat line; my call) or before
  the leaves load: the line is just "2 monitors" (today's keys). The count comes from the bubble
  (`cluster.pointCount`), as now, so it shows at once; the area fills in when leaves arrive.
- Everything else stays: the title, the level-name line, the larger text, max/min.
- Messages: new plural keys for count plus area, e.g.
  `mapsdk_monitor_cluster_count_area_one`/`_other`: "{count} monitor within a {area} mi² area" /
  "{count} monitors within a {area} mi² area" (one whole sentence per key, no concatenation). The
  area number is formatted with the `format` provider to 3 decimals; whether it gets a thousands
  separator is the builder's call (the old map had none).
- **Reverses** the user's 2026-11-04 milestone 2 parity decision ("the cluster tooltip is like
  today's, with no area line"), recorded only in data-dashboard's `prompt-map-widget.txt`. Say so
  in the change notes (below). The coordinator updates that prompt.

## 3. Fire tooltip: the reading box (layout B)

Both fire groups (below zoom 10) and single hotspots (zoom 10 and up) show the monitor-style
tooltip: `MonitorReadingBox` on the left, a detail column on the right. Replaces today's generic
`TooltipItem` (name header, "0.7 MW", level chip).

| | Group | Hotspot |
|---|---|---|
| Box header | "Fire (MW)" | "Fire (MW)" |
| Box value | average FRP, large | FRP, large |
| Box subheading | "Average" when count ≥ 2; none for a group of 1 | none |
| Box color | the value's fire level color | same |
| Detail, bold | "1 fire detection" / "3 fire detections" | "Fire detection" |
| Detail, level | level label with units, "50–149 MW" | same |

- **Header** is a message key filled with the scale's units, e.g. `mapsdk_hms_fire_box_header`:
  "Fire ({units})" with units "MW" from the `fire-frp` scale (the scale's own label is "Fire
  Radiative Power"). No hardcoded units.
- **Value (user, 2026-11-07): one decimal, cut off, not rounded** (9.96 → "9.9", so the number
  never contradicts its `<10` level), as the monitor tooltip truncates. Groups and hotspots alike;
  "412.0" keeps its decimal. Through the `format` provider. The decimals come from the metadata's
  display precision for `fire-frp` (1 today), as list rows' do.
- **List rows cut off too (user, 2026-11-08).** Fire rows in the keyboard list, and their
  accessible names, show the same cut-off value as the box ("3 fire detections, 9.9 MW, <10"),
  not today's rounded one ("10.0 MW"), so the box, the row and the spoken label always agree.
  Fire only: monitors have the same split today (the box cuts 9.06 to "9", the row rounds it to
  "9.1" next to "Good"); that is out of scope and recorded in data-dashboard's `DEFERRED.md`.
  How the fire plugin asks for cut-off formatting (e.g. a `pointsPlugin` option) is the
  builder's; it is public API if exposed, so it goes in the README.
- **Level** from the scale, half-open `[min, max)` as monitors (`levelFor`). Level line is a message
  key such as "{level} {units}"; with no level (no scale yet, or a value outside every range) the
  box is neutral and the line says `mapsdk_no_level`, as monitors do.
- **Group names (user, 2026-11-07):** a group always names its count, "1 fire detection" included
  (a group of 1 is still a group); a hotspot is "Fire detection". The names are set in
  `createHmsFireStore` (`src/lib/stores/hms-stores.svelte.ts`), so the keyboard list rows and
  their accessible names change the same way, and still carry the value and level as today. Needs
  plural keys (`mapsdk_hms_fire_detections_one`/`_other`); today a group of 1 uses
  `mapsdk_hms_fire_detection`.
- The count for the subheading: the box needs the group's `count`. Today the feature properties
  carry only `name` and `value`; the builder adds what the tooltip needs (e.g. a `count` property
  on group features) without the tooltip parsing the name. My call: a feature with a `count`
  property is a group, one without is a hotspot, also when there is no `hotspots` source; hosts
  that build their own groups (the demo's `date-range-source.svelte.ts`) set `count`.
- Replacing `mapsdk_hms_fire_detection`/`mapsdk_hms_fire_detections` with plural keys breaks hosts
  that ship their own catalogs; the change notes say so (my call).
- **No detection time** (user, 2026-11-07), see non-goals.
- Wiring is the builder's: likely a fire tooltip component in `src/lib/presets/`, given to groups
  through the plugin's `tooltip(item)` with `tooltipShowsName: true`, and to hotspots through the
  existing `hoverTooltip`. Without `hotspots` (one source), the same box applies to that source.
- Keyboard focus of a group from the list shows the same box, pinned (as every listed feature).

## 4. Smoke: no hover tooltip

`hmsSmokePlugin` shows no tooltip when a plume is hovered, on every map.

- **Hover skips smoke entirely.** It's not enough to render nothing: a plume under the pointer must
  not win the hover over a feature beneath it from another plugin (e.g. a region, a CalHeatScore
  zone), and must not set the pointer cursor (smoke isn't clickable). Monitors, clusters, and
  collocation sites over a plume keep their tooltips.
- Clicks, `featuresAt`, and `features()` are unchanged: every plume is still listed with its
  density (Light, Medium, Heavy).
- **Keyboard focus (user, 2026-11-07): keep the pinned tooltip.** Focusing a plume's row in the
  feature list still pins the generic tooltip (name and density) to it. It's the only cue on the
  map for sighted keyboard users, and it can't appear by accident.
- Mechanism is the builder's, but it is public API and must be documented in the README: e.g. a
  `MapPlugin` flag (such as `hover: false`) that the interaction router reads to leave the plugin's
  hits out of the hover pick (not out of click hits), exposed as a `shapesPlugin` option that
  `hmsSmokePlugin` sets.
- **Reverses part of** milestone 2's spec (line 203), which listed "tooltips on smoke and fire" as
  an accessibility addition: smoke hover goes; fire keeps a tooltip, now the box; smoke keeps one
  on keyboard focus.

## Change notes

map-sdk has no CHANGELOG, so the notes go in the README (as the user's prompt directs), in a short
"Changes" section for this beta: the four defaults, that the cluster area line is back (reversing
2026-11-04), and the milestone 2 accessibility reversal for smoke hover. Any new public option
(the hover flag) goes in the README's plugin docs, its examples, and
`tests/unit/readme-examples.test.ts`.

## Version

The `package.json` bump to the next beta happens only when the user asks for a release; not part of
this work (my call).

## Proof

1. Tests written failing first:
   - date: "4:00 pm Friday Nov 06, 2026" for `2026-11-07T00:00:00Z`; noon; midnight; a PDT date;
     a non-Pacific device zone (suffix through `zoneLabel` and the monitor tooltip).
   - cluster area: 3 leaves give the same string `@turf/area` + `convertArea(..., "meters",
     "miles").toFixed(3)` gives for their triangle; 2 leaves and collinear leaves show no area; a
     4-leaf case gives the hull's area regardless of leaf order.
   - fire: the box shows the title, the level color, "Average" and the count for a group of ≥ 2;
     a group of 1 shows "1 fire detection" and no "Average"; a hotspot shows no count; truncation
     at a boundary (9.96 → "9.9", `<10`) in the box, the list row, and its accessible name.
   - smoke: a hover gives no tooltip and no pointer cursor; a lower-priority feature beneath a
     plume still gets the hover; `features()` lists every plume with its density; list focus pins
     the tooltip.
2. `npm test`, `npm run check`, `npm run lint`, `npm run test:bundle`, `npm run test:licenses`,
   `npx playwright test --project chromium --project firefox`.
3. Side by side: monitor-map `release/5.0.0` built against this branch (throwaway worktree in the
   scratchpad, `npm pack` tarball, port 5181) through `scripts/compare/compare.mjs`, monitor,
   cluster, fire and smoke pairs shown to the user.

## Constraints

From `CLAUDE.md`: theme tokens only, every string a `mapsdk_*` key with no concatenated sentences,
Pacific dates through the `format` provider, color never alone (levels have labels), license rule,
`./data` and `./stores` off the map engine. Don't modify monitor-map, the dashboard, sdk-js, or
sjvair.com. Ask before pushing; never merge, tag, release, or publish without the user's yes.
