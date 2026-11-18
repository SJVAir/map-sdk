# The lens hides its townships once their sections have drawn (`0.1.0-beta.21`)

## Why

On each recentre, `shapesLens` flashes its newly covered townships clear for about a frame. The user
saw it on the dashboard's Map (2026-11-17).

## Cause (confirmed 2026-11-17)

A browser repro read every rendered frame across a recentre. It checked each township's
`lensHidden` state and whether a lens section is rendered at the township's centre:

- The hide effect calls `setHidden` in the same flush as the inner `shapesPlugin`'s `setData`. The
  feature state applies at the next render. The sections arrive later: the worker parses the data,
  then the tiles reload.
- So for **2 rendered frames** on every recentre, the newly covered townships are hidden with no
  section over them (clear). The same happens on the first raise.
- **The opposite happens too.** The townships the lens leaves (and all of them on release) are
  un-hidden while the old sections still draw, so they show through the old sections for the
  same 2 frames.
- On a dashboard-like grid (9×9 townships of 36 sections, zoom 10, 1200×800), `main` has 20
  mismatched frames over 10 recentres.

A spike also showed that MapLibre's map-level `sourcedata` events for `metadata` and `content`
already report `isSourceLoaded: true`. They fire before the tiles are marked for reload, so they
can't be used.

## Change

`shapesLens` keeps the hidden set it wants as **pending** and applies the whole set, additions and
removals together, once the inner sections' source has loaded the data it was last given:

- The set is applied when a `sourcedata` event for the inner source has `isSourceLoaded` and is a
  tile load (`tile`) or `idle`. The feature state and the new tiles then reach the same render.
- When the hidden set changes and the source has no load pending, the set applies at once. This
  covers a parents reload, the children's scale resolving, no inner source yet, and a source
  with no tiles in view. The check runs on a microtask after the effect, so the inner plugin's
  `setData` in the same flush is already counted, whatever the effect order.
- **A recentre before the previous load finishes** replaces the pending set. MapLibre reports the
  source not loaded while a newer `setData` waits, so only the latest set applies, once.
- **An `error` event for the inner source** applies the pending set at once (today's behaviour), so
  a failed load can't leave townships stuck. While a slow load is pending, the old townships stay
  hidden under the old sections, which still draw, so the map stays consistent.
- Teardown (restyle, removal) clears the hidden set at once, drops anything pending, and removes
  the listeners, as it does today.

`GlMapLike` gains `isSourceLoaded(id): boolean`. MapLibre's `Map` already has it. This is a type
change only for hosts that wrap the GL map. The lens's rules don't change: hover, `pin`/`release`,
Esc, card holds, and `map.pin`'s swap in place. No message keys change.

## Known limit

MapLibre swaps a GeoJSON source's tiles one at a time. When the view spans several tiles that
finish in different frames, the sections in an early tile can draw a frame before the last tile
loads. In that frame, the townships under them still show through, as a tint and never clear.
The spike saw this in 1 of 3 small-grid runs and in 0 of 30 recentres on the dashboard-like grid.
Fixing it would need per-tile hiding or double-buffered sources.

## Testing

- Client (`tests/client/plugins/shapes-lens.test.ts`, with `fake-gl` able to hold a source's data
  as loading): the set applies only on the tile/idle event; `metadata`/`content` events don't
  apply it; a second recentre before load applies only the latest; `error` applies it; a change
  with nothing pending applies at once; teardown with a load pending clears it.
- Browser (`tests/browser/lens.browser.test.ts`): across several recentres and a release, no
  rendered frame has a hidden township without a section, or a section over a township that isn't
  hidden. The view sits inside one tile, so MapLibre's per-tile swap can't make the test flaky.
