# `@sjvair/map-sdk` `0.1.0-beta.23`: the dropdown label press, child-row alignment, and two lens flashes

Date: 2026-11-24. A small change set, for the data-dashboard project (its coordinator's brief and
two items in data-dashboard's `DEFERRED.md` whose trigger is "the next `@sjvair/map-sdk` beta").

## Why

- On sjvair.com (monitor-map 5.0 on `0.1.0-beta.22`), a press on an options row's label text can
  close the wide dropdown instead of toggling the row. Any host that puts the map inside a
  focusable element (`<main tabindex="-1">` there; the dashboard's widget frame is `tabindex="0"`)
  hits it.
- In the Monitors dropdown, the child rows' checkboxes sit about 5px left of the parent's icon.
  The user wants them lined up with it.
- Two short lens flashes the dashboard's scripted lens check found on `0.1.0-beta.22`: arriving
  townships go clear for 3–6 frames on a block's first visit, and a township the lens leaves goes
  clear for 1 frame.

## Goals

1. A press anywhere inside an open wide dropdown that can't take focus (a row's label text, a
   heading, padding) never closes it, for every row kind: checkbox, checkbox with children
   (chevron), select-all group, radio. The label press toggles its row as a box press does.
   Tabbing past the last row, Esc, and a click outside the toolbar still close it.
2. A child row's checkbox is centred under its parent row's icon; under a parent with no icon,
   its left edge lines up with the parent's label. Each nesting level lines up with the one above.
   The guide line stays under the parent's checkbox. Wide dropdowns and the narrow panel alike.
3. An arriving township is hidden under its sections only once the host says it holds all of that
   township's sections, so it never shows clear while only a few cached edge sections are drawn.
4. A township the lens leaves shows again on the frame its sections go, not when the whole new
   set of sections has loaded.

## Non-goals and anti-goals

- No guessing in map-sdk whether a township's sections are complete (area or count checks): a
  township with missing sections would never hide. Without the host's answer, behaviour stays as
  in `0.1.0-beta.22`.
- No change to the narrow panel's focus handling beyond what goal 1 needs (it already ignores
  focus leaving).
- The one-frame tint at a tile edge on recentre (deferred 2026-11-17) is not in scope; goal 4 may
  produce that same tint and nothing worse.
- No new message keys.

## Approaches (chosen by the user, 2026-11-24)

**Dropdown.**
- A. In `onfocusout`, ignore focus moving to an element that contains the dropdown. One line;
  but a host moving focus to such an ancestor for its own reasons would leave the dropdown open.
- **B (chosen).** Ignore focus leaving only while a pointer press that began inside the dropdown
  is under way (a capture-phase `pointerdown` flag, cleared after the press ends, as the toolbar's
  other "who caused it" flags are). It targets the real cause; focus leaving for any other reason
  still closes.

**Arriving townships.** One sensible way, the user's call over map-sdk guessing: a new optional
`shapesLens` option the host answers, since only the host knows what it has loaded (the dashboard
keeps earlier blocks' sections and already tracks which blocks are loaded).

**Leaving townships.**
- A. Show leaving townships as soon as the new sections are sent: old sections may still draw over
  them for a frame (a tint).
- **B (chosen).** Show a leaving township when the first reloaded tile of the sections' source that
  overlaps it arrives, before the whole source has loaded. Its sections go on that frame. A
  township across two tiles can tint for a frame in the slower one (the kind already deferred).

**Alignment.** One sensible way: shift the child rows (padding), not the parent row. Shown to and
approved by the user as a before/after of the real Monitors dropdown (child checkboxes 5px right,
centres at the icon's centre).

## Design

### Dropdown (`src/lib/options/OptionsMenu.svelte`)

- A `pointerdown` listener in the capture phase on the menu's root sets `pressing = true`; it is
  cleared after the press ends (`pointerup` / `pointercancel`, then a `setTimeout` so the click
  and Svelte's microtask flush have run).
- `onfocusout`: while `pressing`, focus leaving does not close. Otherwise unchanged.
- The click then reaches the label, which toggles its input. The toolbar's document click handler
  is unchanged (a click outside the toolbar still closes).

### Alignment (`src/lib/options/OptionRows.svelte`)

- Today: row padding 0.75rem, checkbox 1rem, gap 0.5rem, icon 1.25rem; children block indented
  1.25rem with a 1px left border.
- The guide line stays a 1px left border but always takes its width (`var(--border, transparent)`,
  the block's margin 1px less), so the alignment holds whether or not a host defines `--border`.
  (A first try drew it as an inset shadow; a hovered child row's background covered it.) The
  children block of a row with an icon gets child-row left
  padding of `1.125rem` (checkbox centre = icon centre); of a row without an icon, `1rem`
  (checkbox left = label left). Applies to both `checkbox`-with-children and `group` rows. A
  nested block's margin is its parent row's padding plus half a checkbox, less the line's 1px.
- Radio help text indents (`mapsdk-option-help`) are untouched.

### Lens (`src/lib/plugins/shapes-lens.svelte.ts`)

- New option `childrenLoaded?(parentKey: string): boolean`: whether the source holds every child
  of that parent. Read reactively (the hidden set recomputes when its answer changes). Omitted,
  it is always `true` (today's behaviour). Documented in the README with the dashboard-shaped
  example (a set of loaded blocks).
- The hidden set: a parent in the block with a drawn child **and** `childrenLoaded(parent)`.
- Applying a new hidden set splits it:
  - **Hiding** (parents newly in the set) waits, as now, for the children's source to load (tile
    or `idle` sourcedata with `isSourceLoaded`), `error`, or the map's `idle`.
  - **Showing** (parents leaving the set) happens at the first `sourcedata` tile event of the
    children's source after the change whose tile bounds overlap the parent's geometry bbox,
    whether or not the source has finished loading; the whole-load, `error` and `idle` backstops
    show any still left. When the children have no layers (nothing to wait for), both apply at
    once, as now.
  - A newer set replaces what is pending: a parent pending show that is hidden again in the new
    set stays hidden; a parent pending hide that leaves it is dropped from the hide.

## Testing

- **Dropdown:** browser tests (real mouse via Vitest's `userEvent`) with the toolbar inside a
  `tabindex="-1"` ancestor and a `tabindex="0"` one: press a label twice, opened by click and by
  hover, for each row kind; the dropdown stays open and the value toggles both times. Tabbing past
  the last row still closes. `park-pointer` in `afterEach`. Each must fail with the fix removed.
- **Alignment:** a browser test measuring that a child checkbox's centre equals the parent icon's
  centre (and label left with no icon), wide and narrow.
- **Lens:** tests in the existing lens spec style (client for state, browser for GL events) for:
  `childrenLoaded` false keeps a parent shown under drawn children, then true hides it after load;
  a leaving parent shows at its overlapping tile's event, before the source has loaded. Each must
  fail with the fix removed.
- While building: run only the spec files a task touches; the full suite, `test:bundle` and
  Chromium/Firefox e2e once at the end.
- **Real hosts:** the dropdown on local sjvair.com (by patching a local copy only, never the
  stack); both lens flashes with `.superpowers/lens-check/` in a data-dashboard worktree whose
  local, untracked patch passes `childrenLoaded` from its loaded blocks. Results go to the
  coordinator.

## What consumers see

- `shapesLens` gains the optional `childrenLoaded`. Without it, the arriving flash stays.
- Options child rows move right by about 5px (under an icon) or 4px (no icon).
- No new message keys, props removed, or export changes; the `@sjvair/sdk` peer range is unchanged.

## Release housekeeping

Version `0.1.0-beta.23` in the same PR; README "Changes", the `shapesLens` section and examples
test, and CLAUDE.md's architecture lines.

## Left to the builder

The exact clearing of the press flag, how tile bounds are computed from the event's tile id, and
the test fixtures, within the rules above.
