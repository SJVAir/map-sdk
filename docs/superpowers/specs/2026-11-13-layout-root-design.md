# MapView `layoutRoot`: the box the toolbar's wide/narrow switch measures

Date: 2026-11-13. Small change; short design.

## Why

`OptionsToolbar`'s wide/narrow switch measures `MapView`'s own box. monitor-map 5.0's `MapShell`
shrinks the map to two thirds when a monitor's detail panel opens. In windows from 48rem up to
about 1152 px, opening a monitor flips the joined dropdown row to the single options button and the
full "Map Options" panel. In monitor-map 4.3.0 and `release/5.0.0`, the switch follows the window,
and the row stays. The user chose (2026-11-13, in monitor-map-29) to let the host mark the box
that holds the whole map, and have the switch measure that box.

## Goals, non-goals, anti-goals

- Goal: a host can make the wide/narrow decision follow a box larger than the map, such as
  MapShell's outer box (map plus detail panel).
- Non-goal: moving anything else. Dropdowns and the narrow panel stay inside the map's box
  (`MapLayout.box()`), and `--mapsdk-toolbar-height` and `--mapsdk-map-width` are unchanged.
- Anti-goal: any change for a host that sets nothing. The dashboard's Map widget and
  `0.1.0-beta.13` hosts must behave exactly as before.

## Approaches

- **A. A `MapView` prop (chosen by the user).** `layoutRoot?: HTMLElement | null`. The host
  writes `bind:this={shell}` and passes `layoutRoot={shell}`. MapShell renders `<MapView>` itself
  and owns the outer box, so nothing has to be passed through other components.
- B. A helper plus an attachment (`const root = mapLayoutRoot()` in the host's script, and
  `{@attach root}` on the element). Svelte context can only be set while a component is starting
  up, so this needs both pieces, plus handling for a stale root. It's only worth it when the root
  is several components up from the map.
- C. A `<MapLayoutRoot>` wrapper component. It adds an element to the host's markup and changes
  how the host lays itself out.

## Design

- `MapView` gains `layoutRoot?: HTMLElement | null` (default unset).
- The measured element is `layoutRoot ?? root`. The new piece watches `layoutRoot`'s width with
  a `ResizeObserver` (`root` keeps its existing `bind:clientWidth`), and re-observes when the prop
  changes element. The width feeds today's `layoutWidth`, a frame later, with the same
  `isWideWidth` (48rem) test. The frame delay stays because changing the layout inside a
  ResizeObserver callback is a ResizeObserver loop.
- **The root goes null** (it unmounted, or `bind:this` cleared it): the map measures its own box
  again. A root width of 0 (detached, or `display: none`) counts the same way as today's unmeasured
  width: wide.
- **Two maps under one root:** each `MapView` gets its own prop, makes its own decision, and
  shares nothing.
- **The root is wide but the map is narrow:** the toolbar stays wide, so the narrow panel doesn't
  show. That's intended. The wide row wraps (`flex-wrap`), and dropdowns are capped by and flipped
  within the map's box, so a 683 px map still fits. A browser test checks this.
- Tests (TDD): with the root at 1024 px and the map at 683 px inside it, the toolbar stays wide.
  With no prop, a 683 px map goes narrow, as today. Setting the prop back to null returns to the
  map's own box. An opened dropdown stays inside the 683 px map. A root under 48rem, as on
  phones where MapShell stacks the panel under the map and the root is as wide as the map, gives
  narrow.
- Docs: the README's "Changes" (naming `layoutRoot`) and "The options toolbar" section, a README
  example and its examples test, the CLAUDE.md View line, and version `0.1.0-beta.14` in the same
  PR.

## Left to the builder

The `ResizeObserver` code's shape, and whether it joins or replaces the `width` source for
`layoutWidth` when the prop is set.
