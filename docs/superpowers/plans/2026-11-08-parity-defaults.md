# Parity defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four new map-sdk defaults from monitor-map 5.0's parity review: the old map's tooltip date
format, the cluster "within a X mi² area" line, the fire reading box, and no smoke hover tooltip.

**Architecture:** Each change stays in the layer that owns it: `format.ts` for dates; a small
cluster-area module plus `MonitorClusterTooltip` for the area; the fire store (names, `count`),
a new `FireTooltip` component wired in `hms-fire.ts`, and an opt-in "cut off, don't round" flag
on list items for fire values; a `hoverable: false` plugin flag the interaction router reads, set
by `hmsSmokePlugin` through `shapesPlugin`.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest (unit / client / browser projects), Playwright,
`@turf/area` (new), `@turf/helpers` (existing).

**Spec:** `docs/superpowers/specs/2026-11-07-parity-defaults-design.md`

## Global Constraints

- Every UI string is a `mapsdk_*` key in `src/lib/data/messages/en.json`; one whole sentence per
  key, plurals as `_one`/`_other`; no concatenated sentences.
- No hardcoded units, labels, colors, or scales: units and level labels come from the `Scale`.
- Dates are Pacific (`America/Los_Angeles`) through the `format` provider; numbers through
  `format.number`.
- Components use theme tokens only; color never carries meaning alone (levels have labels).
- Bundled dependencies: MIT, BSD, Apache-2.0, ISC, MPL-2.0, 0BSD (see `scripts/` license check).
  No `@turf/convex` (its `robust-predicates` dependency is Unlicense): the hull is local code.
- `./data` and `./stores` must stay off maplibre/MapTiler (`npm run test:bundle`).
- Specs live in `tests/`, never `src/lib`. Tabs, double quotes, no trailing commas, width 100.
- Run `npm run test:bundle` before each commit that touches `src/lib`.
- Commits: no AI attribution, no `Co-Authored-By` trailers. Never push, tag, release, or publish
  without the user's yes. No version bump in this work.
- Setup once in the worktree: `npm ci`.

## Review Focus

1. **Smoke drawn above a cluster bubble or monitor** (host draws smoke last): the hover must go to
   the bubble or monitor beneath, as if the plume weren't rendered. Pinned in Task 6.
2. **Truncation float error**: 4.35 at precision 2 must show "4.35", not "4.34"; 0.7 at
   precision 1 "0.7". Pinned in Task 2.
3. **Tooltip before the fire scale resolves** (`units` "", `level` NO_LEVEL): neutral box, "No
   level", header "Fire" (no empty "()"), no crash. Pinned in Task 4.
4. **Cluster leaves resolving after the tooltip moved to another cluster**: the area must belong
   to the current cluster (the existing abort pattern covers it; the area is computed inside the
   same `.then`). Pinned in Task 5.
5. **Non-Pacific device across a DST change**: a July instant shows PDT clock time with " PT"
   in the monitor tooltip. Pinned in Task 1.

---

### Task 1: Date-time format

**Files:**
- Modify: `src/lib/data/format.ts`
- Test: `tests/unit/data/format.test.ts`, `tests/browser/monitor-tooltips.browser.test.ts`
  (lines 48, 339, 340 expect the old format)

**Interfaces:**
- Produces: `FormatProvider.dateTime(value)` → `"h:mm aaa EEEE MMM dd, yyyy"` in Pacific, e.g.
  `"4:00 pm Friday Nov 06, 2026"`. Signature unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/unit/data/format.test.ts` (replace the two
  "12:30 PM" tests):

```ts
it("formats like the old map, in Pacific time", () => {
	expect(format.dateTime("2026-11-07T00:00:00Z")).toBe("4:00 pm Friday Nov 06, 2026");
});
it("noon is 12:00 pm and midnight 12:00 am", () => {
	expect(format.dateTime("2026-11-06T20:00:00Z")).toBe("12:00 pm Friday Nov 06, 2026");
	expect(format.dateTime("2026-11-06T08:00:00Z")).toBe("12:00 am Friday Nov 06, 2026");
});
it("uses daylight time in summer", () => {
	expect(format.dateTime(new Date("2026-07-01T19:30:00Z"))).toBe(
		"12:30 pm Wednesday Jul 01, 2026"
	);
});
it("stays Pacific on a device elsewhere", () => {
	const ny = createDefaultFormat("America/New_York");
	expect(ny.dateTime("2026-11-07T00:00:00Z")).toBe("4:00 pm Friday Nov 06, 2026");
	expect(ny.zoneLabel()).toBe("PT");
});
```

  In `monitor-tooltips.browser.test.ts`, change the expectations to the new strings
  (`"1:00 pm Tuesday Nov 03, 2026"`, `"1:02 pm Tuesday Nov 03, 2026"`), and add to the
  `MonitorTooltip` describe:

```ts
it("adds PT after the time on a device outside Pacific", async () => {
	render(MonitorTooltip, {
		item: item(12.6),
		timestamp: "2026-07-01T19:30:00Z",
		scale: pm25Scale,
		messages: defaultMessages,
		format: createDefaultFormat("America/New_York"),
		interval: null
	});
	expect(document.body.textContent).toContain("12:30 pm Wednesday Jul 01, 2026 PT");
});
```

- [ ] **Step 2: Run, expect FAIL**: `npx vitest run --project unit tests/unit/data/format.test.ts`
  and `npx vitest run --project browser tests/browser/monitor-tooltips.browser.test.ts`
  (old "Nov 6, 2026, 4:00 PM" output).
- [ ] **Step 3: Implement** in `format.ts` with `Intl.DateTimeFormat("en-US", { timeZone:
  PACIFIC, hour: "numeric", minute: "2-digit", hour12: true, weekday: "long", month: "short",
  day: "2-digit", year: "numeric" }).formatToParts(...)`, assembled as
  `` `${hour}:${minute} ${dayPeriod.toLowerCase()} ${weekday} ${month} ${day}, ${year}` ``. Build
  the formatter once per `createDefaultFormat`. Update the interface doc comment with the pattern.
- [ ] **Step 4: Run both test files, expect PASS.** Also `grep -rn "dateTime(" src/lib` to confirm
  the only callers are `MonitorTooltip` and `CollocationTooltip`; run
  `npx vitest run --project browser tests/browser/monitor-tooltips.browser.test.ts` for the
  collocation cases too.
- [ ] **Step 5: Commit** `git commit -m "Tooltip times use the old map's format, in Pacific time"`

### Task 2: Cut-off values for list items

**Files:**
- Modify: `src/lib/ui/value-format.ts`, `src/lib/core/plugin.ts` (`FeatureListItem`),
  `src/lib/ui/feature-list.ts` (`rowLabel`), `src/lib/ui/FeatureList.svelte` (`formatValue`),
  `src/lib/ui/TooltipItem.svelte`, `src/lib/plugins/points.svelte.ts`
- Test: `tests/unit/ui/value-format.test.ts` (create), `tests/unit/ui/feature-list.test.ts`,
  `tests/client/plugins/points.test.ts`

**Interfaces:**
- Produces: `formatValue(value: number, precision: number | undefined, format: FormatProvider,
  truncate = false): string`; `FeatureListItem.truncate?: boolean` ("Cut a numeric `value` off at
  `precision` instead of rounding it, so the number never reads as the next level"); `PointsOptions
  .truncateValues?: boolean` (default false) → every item it lists gets `truncate: true`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/ui/value-format.test.ts
const format = createDefaultFormat("America/Los_Angeles");
it("rounds by default", () => expect(formatValue(9.96, 1, format)).toBe("10.0"));
it("cuts off when asked", () => {
	expect(formatValue(9.96, 1, format, true)).toBe("9.9");
	expect(formatValue(412, 1, format, true)).toBe("412.0");
	expect(formatValue(0.7, 1, format, true)).toBe("0.7");
	expect(formatValue(4.35, 2, format, true)).toBe("4.35");
	expect(formatValue(1.15, 2, format, true)).toBe("1.15");
});
it("without a precision, truncate changes nothing", () =>
	expect(formatValue(9.96, undefined, format, true)).toBe(format.number(9.96)));
```

  In `feature-list.test.ts`: `rowLabel` of an item `{ value: 9.96, precision: 1, truncate: true,
  units: "MW", level: <fire "<10"> }` contains `"9.9 MW"` and not `"10.0"`. In `points.test.ts`:
  a `pointsPlugin({ ..., truncateValues: true })` lists items with `truncate: true`; without the
  option, items have no `truncate` key.
- [ ] **Step 2: Run, expect FAIL** (`npx vitest run tests/unit/ui tests/client/plugins/points.test.ts`).
- [ ] **Step 3: Implement.** Cut-off with float guard:
  `Math.trunc(Number((value * 10 ** p).toPrecision(12))) / 10 ** p`, then the existing
  fixed-decimals `format.number`. Pass `item.truncate` through in `rowLabel`, `FeatureList`'s
  `formatValue(row)`, and `TooltipItem`.
- [ ] **Step 4: Run, expect PASS.** `npm run test:bundle`.
- [ ] **Step 5: Commit** `git commit -m "List items can cut values off instead of rounding"`

### Task 3: Fire store: group counts and names

**Files:**
- Modify: `src/lib/data/types.ts`, `src/lib/stores/hms-stores.svelte.ts`,
  `src/lib/data/messages/en.json`, `demo/date-range-source.svelte.ts`
- Test: `tests/unit/stores/hms-stores.test.ts`

**Interfaces:**
- Produces: `export interface FireFeatureProperties extends MapFeatureProperties { /** Set on a
  group: how many detections it averages. Absent on a single detection. */ count?: number }`
  (exported from `./data`); `createHmsFireStore().groups` features carry `count`; group names come
  from `mapsdk_hms_fire_detections` with `{ count }` for every group.
- Messages: remove `mapsdk_hms_fire_detections`; add `mapsdk_hms_fire_detections_one`:
  `"{count} fire detection"`, `mapsdk_hms_fire_detections_other`: `"{count} fire detections"`.
  Keep `mapsdk_hms_fire_detection` ("Fire detection") for hotspots.

- [ ] **Step 1: Update the failing test** "gives cleaned hotspots and groups": merged group
  `properties` include `count: 2` and name `"2 fire detections"`; the single group's name is
  `"1 fire detection"` with `count: 1`; hotspot properties stay exactly as today (no `count`).
- [ ] **Step 2: Run, expect FAIL** (`npx vitest run --project unit tests/unit/stores/hms-stores.test.ts`).
- [ ] **Step 3: Implement.** Demo: its own groups add `count: g.count` and name
  `` g.count === 1 ? "1 fire detection" : `${g.count} fire detections` `` (demo strings are not
  shipped).
- [ ] **Step 4: Run, expect PASS**; `npm run check`; `npm run test:bundle`.
- [ ] **Step 5: Commit** `git commit -m "Fire groups carry their count and always name it"`

### Task 4: Fire tooltip box

**Files:**
- Create: `src/lib/presets/FireTooltip.svelte`
- Modify: `src/lib/presets/hms-fire.ts`, `src/lib/data/messages/en.json`
- Test: `tests/browser/hms-fire-tooltip.browser.test.ts`, `tests/client/presets/hms.test.ts`
  (line ~286 hotspot hover test keeps passing)

**Interfaces:**
- Consumes: `formatValue(..., truncate)` (Task 2), `FireFeatureProperties.count` (Task 3),
  `MonitorReadingBox` (`color`, `header`, `value`, `large`, `subheading`), `componentSnippet` from
  `./monitors.js`, `PointsTooltipEnv`.
- Produces: `FireTooltip.svelte` props `{ item: FeatureListItem; count: number | null; messages:
  MessageProvider; format: FormatProvider }` (`count` null = a single detection).
- Messages: `mapsdk_hms_fire_box_header`: `"Fire ({units})"`, and `mapsdk_hms_fire_box_header_no_units`:
  `"Fire"` when `item.units` is empty; `mapsdk_hms_fire_average`:
  `"Average"`; `mapsdk_level_with_units`: `"{level} {units}"`.

Layout: the box (header from `item.units`; value `formatValue(item.value, item.precision, format,
true)`, large; subheading "Average" only when `count !== null && count >= 2`; color
`item.level.color`, neutral without a level) beside a column with the name (bold, `text-lg`) and
the level line (`mapsdk_level_with_units`, or `mapsdk_no_level`). Reuse the monitor tooltip's
`mapsdk-monitor-tip`-style flex layout and `mapsdk-tooltip-wide` class. No time.

Wiring in `hms-fire.ts`: `firePoints` passes `truncateValues: true`, `tooltipShowsName: true`, and
`tooltip: (item, props, env) => componentSnippet(FireTooltip, { item, count: typeof props.count
=== "number" ? props.count : null, messages: env.messages, format: env.format })`. With `hotspots`,
the outer plugin sets `tooltip: groups.tooltip`, `tooltipShowsName: true`, and `hoverTooltip(hit)`
finds the hotspot item in `singles.features()` and returns `singles.tooltip?.(item)`; drop
`ctxNow` and the `TooltipItem` import. Update the preset's doc comment.

- [ ] **Step 1: Write the failing browser tests** (render `FireTooltip` directly with `fireScale`
  levels, and keep one through `MapTooltip` for the hotspot):

```ts
it("a group shows the box: title, cut-off average in its level color, Average, count, level", ...)
	// item value 62.47, precision 1, level fireScale.levels[2], units "MW", name "3 fire detections", count 3
	// text contains "Fire (MW) 62.4 Average", "3 fire detections", "50–149 MW"
	// box background rgb(255, 69, 0)
it("a group of 1 has no Average", ...)   // name "1 fire detection", count 1 → no "Average"
it("a hotspot shows no count line or Average", ...) // count null, name "Fire detection"
it("cuts off at a level boundary: 9.96 shows 9.9 beside <10 MW", ...)
it("without a scale yet: neutral box, header Fire, No level", ...) // level NO_LEVEL, units ""
```

  Rewrite the existing `MapTooltip` hotspot test's expected text to
  `"Fire (MW) 200.0 Fire 150–349 MW"` (the hovered hotspot: box, name, level; no header row) —
  adjust spacing to what the DOM gives, keeping those tokens in order.
- [ ] **Step 2: Run, expect FAIL** (`npx vitest run --project browser tests/browser/hms-fire-tooltip.browser.test.ts`).
- [ ] **Step 3: Implement** `FireTooltip.svelte` and the wiring.
- [ ] **Step 4: Run, expect PASS**; `npx vitest run --project client tests/client/presets/hms.test.ts`;
  `npm run test:bundle`.
- [ ] **Step 5: Commit** `git commit -m "Fire tooltips use the reading box"`

### Task 5: Cluster area line

**Files:**
- Create: `src/lib/presets/cluster-area.ts`
- Modify: `src/lib/presets/MonitorClusterTooltip.svelte`, `src/lib/data/messages/en.json`,
  `package.json` / `package-lock.json` (`npm install @turf/area@^7.4.0`)
- Test: `tests/unit/presets/cluster-area.test.ts` (create),
  `tests/browser/monitor-tooltips.browser.test.ts`

**Interfaces:**
- Produces: `convexHull(points: Array<[number, number]>): Array<[number, number]>` (monotone
  chain on lng/lat, counter-clockwise, no repeated closing point, collinear points dropped);
  `clusterAreaSqMiles(points: Array<[number, number]>): number` (0 when the hull has fewer than 3
  points; else `convertArea(area(polygon([[...hull, hull[0]]])), "meters", "miles")`).
- Messages: `mapsdk_monitor_cluster_count_area_one`: `"{count} monitor within a {area} mi² area"`,
  `mapsdk_monitor_cluster_count_area_other`: `"{count} monitors within a {area} mi² area"`.

- [ ] **Step 1: Write the failing tests**

```ts
// cluster-area.test.ts
const tri: Array<[number, number]> = [[-119.7, 36.7], [-119.6, 36.7], [-119.6, 36.8]];
it("3 points: the old map's triangle area", () => {
	const expected = convertArea(area(polygon([[...tri, tri[0]]])), "meters", "miles").toFixed(3);
	expect(clusterAreaSqMiles(tri).toFixed(3)).toBe(expected);
});
it("2 points, one spot, or a line: 0", () => {
	expect(clusterAreaSqMiles(tri.slice(0, 2))).toBe(0);
	expect(clusterAreaSqMiles([tri[0], tri[0], tri[0]])).toBe(0);
	expect(clusterAreaSqMiles([[-119.7, 36.7], [-119.6, 36.7], [-119.5, 36.7]])).toBe(0);
});
it("4+ points: the hull's area, whatever the order", () => {
	const square: Array<[number, number]> = [[-119.7, 36.7], [-119.6, 36.8], [-119.6, 36.7], [-119.7, 36.8]];
	const inner: [number, number] = [-119.65, 36.75];
	const a = clusterAreaSqMiles([...square, inner]);
	expect(clusterAreaSqMiles([inner, ...square.reverse()])).toBeCloseTo(a, 9);
	const ordered = [square[0], square[2], square[1], square[3]];
	expect(a).toBeCloseTo(convertArea(area(polygon([[...ordered, ordered[0]]])), "meters", "miles"), 9);
});
```

  Browser (`MonitorClusterTooltip`): the existing 3-monitor test now expects
  `` `3 monitors within a ${expected} mi² area` `` (expected computed as above from its three
  coords) and no "covering"; the 2-monitor tests keep `"2 monitors"` exactly; add "collinear
  leaves show just the count" (3 leaves on one latitude → text contains `"3 monitors"` and not
  `"within"`); add "leaves a few metres apart show just the count" (3 leaves within 0.00001° →
  no "within"); add "the area belongs to the current cluster": rerender with a second cluster
  whose first `leaves()` never resolves after the first resolved → the old area is not shown.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** In the tooltip's leaves `.then`, store `area:
  clusterAreaSqMiles(found.map((l) => l.lngLat))` with the other leaf data. The count line uses
  `mapsdk_monitor_cluster_count_area` with `{ count: cluster.pointCount, area: format.number(a,
  { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false }) }` when the area
  formats to anything but `"0.000"`, else `mapsdk_monitor_cluster_count` as today.
- [ ] **Step 4: Run, expect PASS**; `npm run test:licenses`; `npm run test:bundle`.
- [ ] **Step 5: Commit** `git commit -m "Cluster tooltips show the monitors' area again, as a convex hull"`

### Task 6: Smoke takes no hover

**Files:**
- Modify: `src/lib/core/plugin.ts` (`MapPlugin.hoverable`), `src/lib/core/interactions.svelte.ts`,
  `src/lib/core/plugin-host.svelte.ts:432-436`, `src/lib/plugins/shapes.svelte.ts`,
  `src/lib/presets/hms-smoke.ts`
- Test: `tests/client/core/interactions.test.ts`, `tests/client/presets/hms.test.ts`,
  `tests/browser/tooltip.browser.test.ts`

**Interfaces:**
- Produces: `MapPlugin.hoverable?: boolean` (default true; false: the plugin's features never take
  the hover, never set the pointer cursor, and never hide a feature beneath from the hover; clicks,
  `featuresAt`, and list focus are unchanged); `InteractionRouter.register(pluginId, layerIds,
  toHit, priority = 0, hoverable = true)`; `ShapesOptions.hoverable?: boolean` (default true) →
  `plugin.hoverable = false` when false; `hmsSmokePlugin` passes `hoverable: false`.

Rule: hover and cursor are computed as if non-hoverable features weren't rendered (the blocked
check included), while click hits and `featuresAt` use every feature as today.

- [ ] **Step 1: Write the failing tests** in `interactions.test.ts` (`describe("non-hoverable
  plugins")`, using a `points("smoke", "region")` plugin with `hoverable: false`):
  - "a hover over only a non-hoverable feature hovers nothing and sets no pointer cursor"
  - "a feature beneath a non-hoverable one takes the hover, whatever the priorities" (smoke topmost
    with `hoverPriority` 5, region beneath at 0 → hovered is the region)
  - "a blocking bubble beneath a non-hoverable feature gives its own hover" (Review Focus 1)
  - "clicks and featuresAt still include non-hoverable hits"

  In `hms.test.ts`: `hmsSmokePlugin(...).hoverable` is `false`; `features()` lists every plume
  with its density level (existing test, keep). In `tooltip.browser.test.ts`: focusing a smoke
  plume (`map.focusFeature(refKey, pluginId)`) shows a tooltip containing "Smoke" and "Medium".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Router: keep `hoverable` on the `Registration`; compute the click
  lookup over all rendered features and the hover lookup over those whose registration is
  hoverable (one shared helper over a feature list). Plugin host passes
  `running.plugin.hoverable ?? true`. Shapes and smoke as above; update both doc comments.
- [ ] **Step 4: Run, expect PASS**; full `npm test`; `npm run test:bundle`.
- [ ] **Step 5: Commit** `git commit -m "Smoke plumes take no hover; list focus still shows their tooltip"`

### Task 7: README, change notes, full checks

**Files:**
- Modify: `README.md`, `tests/unit/readme-examples.test.ts` (only if an example uses a new option)

- [ ] **Step 1:** README: in "Writing a plugin", document `hoverable` beside `hoverPriority`; in the
  points/shapes option docs, `truncateValues` and `hoverable`; `FeatureListItem.truncate` where
  item fields are described. Add a "Changes" section before "Development" headed for the next beta
  ("Unreleased, after 0.1.0-beta.3") listing: the date format (with " PT" off Pacific); the
  cluster area line is back as "within a X mi² area" from the monitors' convex hull, reversing the
  2026-11-04 "no area line" decision; fire tooltips are the reading box, fire values are cut off
  in box, list and accessible name; group names always carry the count; `mapsdk_hms_fire_detections`
  is now `_one`/`_other` (breaking for hosts with their own catalogs); smoke shows no hover
  tooltip (keyboard focus still does), reversing part of milestone 2's accessibility additions;
  new options `hoverable`, `truncateValues`, `FeatureListItem.truncate`,
  `FireFeatureProperties`.
- [ ] **Step 2: Full checks, all must pass:** `npm test`, `npm run check`, `npm run lint` (run
  `npm run format` first), `npm run test:bundle`, `npm run test:licenses`,
  `npx playwright test --project chromium --project firefox`.
- [ ] **Step 3: Commit** `git commit -m "README: parity defaults change notes and new options"`

### Task 8: Side by side with the old map (manual, no commits)

- [ ] `npm pack` in the worktree (into the scratchpad).
- [ ] `git -C /home/alex/workspace/sjvair/monitor-map worktree add --detach <scratchpad>/mm-compare origin/release/5.0.0`
  (fetch first); copy monitor-map's `.env` without printing it; `npm ci`; `npm install
  <tarball>`; `rm -rf node_modules/.vite`.
- [ ] `ss -ltnp | grep 5181` must be empty (else message `monitor-map-2a` and wait); start
  `npx vite --port 5181 --strictPort` in the background and note its PID.
- [ ] `node scripts/compare/compare.mjs --local http://localhost:5181 --out <scratchpad>/compare`
  (local stack must be ingesting).
- [ ] Show the user the monitor, cluster, fire and smoke pairs (desktop and phone).
- [ ] Stop the server by PID; `git -C /home/alex/workspace/sjvair/monitor-map worktree remove --force <scratchpad>/mm-compare`.

### Task 9: Review, PR, and dashboard docs

- [ ] Full-branch review (superpowers:requesting-code-review); fix what it confirms.
- [ ] Ask the user before pushing. After the yes: push, open one PR into `main` (no AI
  attribution).
- [ ] In `/home/alex/workspace/sjvair/data-dashboard/.worktrees/docs-map-sdk`
  (`git fetch && git checkout --detach origin/main`): `DEFERRED.md` gets the monitors' rounding
  split (box cuts to a whole number, list row rounds to one decimal, so 9.06 reads "9.1, Good";
  why: out of this work's scope; revisit: when monitor values or list formatting are next touched,
  or a user reports it) unless the coordinator already added it; `TODO.md` marks the "monitor-map's
  verdicts as map-sdk defaults" item in review with the PR link. Prettier, docs-only commit,
  rebase, push to `main`.
- [ ] Tell `data-dashboard-23` the PR is open. After the user merges: mark it merged in `TODO.md`
  and tell `data-dashboard-23` and `monitor-map-2a`.
