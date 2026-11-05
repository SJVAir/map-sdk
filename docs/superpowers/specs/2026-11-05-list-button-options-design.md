# `@sjvair/map-sdk`: List button position and focus reveal

Date: 2026-11-05. Status: **approved by the user 2026-11-05.**
Release 1, step 5 (data-dashboard `TODO.md` → "Release 1, step 5"). Builds on milestone 2
(`2026-11-04-map-sdk-milestone-2-design.md`, merged #4).

## Intent

monitor-map 5.0 is being rebuilt on map-sdk, and its first 5.0 beta waits for this change.
`MapView` draws the List button and its feature list panel at a fixed top-left corner
(`.mapsdk-list-panel` in `src/lib/view/MapView.svelte`, scoped CSS), and no option moves it.
monitor-map's options toolbar and search sit in that corner, and monitor-map won't override
map-sdk's CSS. So `MapView` needs real options.

**The user's decisions (2026-11-05), for monitor-map:** its List button goes **top right, below
the engine's zoom/compass/locate-me controls** (`controls="engine"`), and it is **shown only on
keyboard focus**: hidden until Tab reaches it, like a skip link, but still in the accessibility
tree. The panel the button opens stays visible while it's open. When the button appears, it
**appears in place, looking exactly like the normal List button** with its usual focus ring (the
user agreed, 2026-11-05).

The options are general, not shaped around monitor-map: the dashboard's Map widget will use
`MapView` too.

## Goals

1. A **position** for the List button and panel: any of the four corners.
2. A **reveal** mode: always visible (today), or visible only while it, or its open panel, has
   keyboard focus.
3. Both default to today's behavior. `featureList`, `featureList={true}`, and
   `featureList={false}` keep working exactly as now; the demo and existing tests don't change.

## Non-goals

- EV stations in the list (monitor-map's own plugin contributes rows through
  `MapPlugin.features()`; nothing needed here).
- An API to open or close the list from outside (monitor-map confirmed it doesn't need one,
  2026-11-05).
- Moving the engine's controls, the credits, or the selection bar.
- Changes to monitor-map, the dashboard, sdk-js, or sjvair.com. Publishing (separate, the user's
  call).

## Anti-goals

- The button overlapping the engine's controls, map-sdk's zoom buttons, or the credits in its
  corner.
- A focus-revealed button that is unreachable by Tab, hidden from screen readers
  (`aria-hidden`, `display: none`, `visibility: hidden`), or invisible while it has focus.
- A focus-revealed panel that vanishes while open because focus moved to the map.
- Breaking today's default layout or Tab order.

## The option shape

```ts
featureList?:
	| boolean
	| {
			/** The corner the List button sits in; its panel opens from there. Default "top-left". */
			position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
			/** "always" (default) shows the button; "focus" shows it only while it or its open panel has keyboard focus. */
			reveal?: "always" | "focus";
	  };
```

`true` equals `{}` (top-left, always). `false` leaves the button and panel out, as now. One prop,
not two, because both settings only matter when the list is on (my call). monitor-map will pass
`featureList={{ position: "top-right", reveal: "focus" }}`.

Changing the options after mount should just work (they're layout, not part of how the GL map is
built). Export the option type (e.g. `FeatureListOptions`) from the main entry so hosts can type
it.

## Position

- The button sits in the chosen corner, inset 0.75rem from both edges as today.
- **Sharing a corner with controls:** when `controls="engine"` puts the engine's controls in that
  corner (today: zoom/compass and locate-me top-right), or `controls="mapsdk"` puts map-sdk's
  zoom buttons there (top-right), the button stacks **below** them, with a gap like the existing
  0.5rem. In a bottom corner it stacks **above** whatever the engine puts there (the credits
  bottom-right; MapTiler's logo bottom-left when the key's plan shows it). It must follow those
  controls' real size (the credits' compact/full switch, the logo appearing), not a hardcoded
  offset.
- **The panel** opens from the corner toward the middle of the map: in a top corner it's below
  the button, in a bottom corner above it; in a right corner it's right-aligned. It fits inside
  the map and **stops short of the controls and credits at the far end of its side** (the user,
  2026-11-05): a top-right panel ends above the bottom-right credits, a bottom-right panel below
  the top-right controls, so they stay visible and clickable while the list is open. Like the
  stacking, this follows those controls' real size. In the default top-left corner this also keeps
  the panel clear of MapTiler's logo bottom-left when the key's plan shows it (my call: the one
  change to the default layout, and only when the logo shows).
- **Panning clear of the panel:** today `map.setListInset(left)` takes the panel's right edge and
  `focusFeature` offsets the camera by half of it. With a right-corner panel the clear part is on
  the left, so the offset must go the other way. Changing `setListInset`'s signature is fine (it's
  internal-facing, used only by `MapView`), but if it is exported in the public API, keep it
  backwards compatible.
- **Stacking order:** the panel stays at `z-index: 2` within the map. Document it in the README,
  so a host can draw its own dropdowns above it. (monitor-map's Overlays and Settings dropdowns
  can overlap a top-right panel and should sit above it, 2026-11-05.)
- **Tab order (my call):** where it is practical, the button comes in Tab order right after the
  controls it stacks below, and before the controls it stacks above. Today, with
  `controls="engine"`, the order is engine controls → credits links → List button; for a top-right
  button the builder should aim for engine controls → List button → credits, but not at the cost
  of a fragile implementation. Report what was done.

## Focus reveal

With `reveal: "focus"`:

- **Hidden:** the standard visually-hidden (skip-link) pattern, the same technique as the existing
  `.mapsdk-sr` class: clipped to 1px, absolutely positioned. Not `display: none`, not
  `visibility: hidden`, not `aria-hidden`, not `opacity: 0` alone (that leaves an invisible click
  target). It stays in the Tab order and the accessibility tree with its existing name ("List of
  features on the map").
- **Shown** while the button or anything inside the panel has focus (`:focus-within` on the
  panel wrapper is the expected tool), and the whole time the panel is open, even after focus
  leaves for the map or elsewhere. While the panel is open the button stays visible too (my call:
  it closes the panel and Escape returns focus to it).
- **Appearing:** in its normal spot (below the controls), exactly the normal button style, with
  the existing focus ring. No animation: it appears and disappears instantly, so there's nothing
  for `prefers-reduced-motion` to change.
- **Hiding again:** when the panel is closed and focus is outside the button and panel.
- Pointer users never see it unless they open the list by keyboard first; that's the user's
  decision for monitor-map, and it's opt-in.
- WCAG 2.2 AA: 2.4.7 and 2.4.11 (the focused button is fully visible, not covered), 2.4.3 (focus
  order), 4.1.2 (name, role, `aria-expanded` unchanged), 2.5.3 (the name starts with the visible
  "List").

## Defaults and compatibility

With no options the DOM, CSS result, Tab order, and inset behavior are today's, apart from the
open panel stopping short of MapTiler's logo (above). The selection bar
keeps its current insets (left 5rem, right 4rem) except in one case (my call): when the button
is top-right with no controls above it (`controls="none"`), it would sit in the bar's row, so the
bar's right inset grows to leave room for it, mirroring the 5rem it leaves on the left for
today's button. A top-right button under the top-right controls is already below the bar's row.

## Tests

- **Browser (Vitest, Chromium):** each corner with each `controls` value places the button inside
  the map, in its corner, not overlapping the controls or credits in that corner; the panel opens
  toward the middle and stops short of the far end's controls and credits;
  `featureList={true}`/`false` unchanged; `reveal: "focus"` is visually hidden but focusable and
  named, shows on focus, stays shown while the panel is open and focus is on the map, and hides after closing and blurring; the inset pans the right way for left and right
  panels.
- **e2e (Playwright, Chromium, Firefox, WebKit in CI):** a demo map with
  `{ position: "top-right", reveal: "focus" }` and `controls="engine"`: keyboard only, Tab reaches
  the hidden button, it becomes visible below the engine controls, Enter opens the list, focus
  into the list, Escape closes and returns focus, Tab away hides it. The existing keyboard test
  keeps passing unchanged.
- `npm run check`, `lint`, `test`, `test:bundle` pass. README token list/examples and
  `tests/unit/readme-examples.test.ts` updated for the new option.
- Screenshots of each corner and of the focus reveal for the user's review.

## Demo

Add a way to see the options in the demo (my call): a switch on the first demo map ("Monitor-map
setup map", the one with `controls="engine"`) that turns on monitor-map's
`{ position: "top-right", reveal: "focus" }`. It's off by default, so the demo's default look and
the existing keyboard e2e test (on the second map) don't change; the new e2e test turns it on
first. A position picker for all four corners there is welcome but optional.

## Left to the builder

- How stacking against the engine's controls is done (measuring the engine's corner, or mounting
  into it), within the anti-goals and the Tab order aim above.
- Class names, internal helper names, the exact type name.
- Whether `setListInset` becomes a signed value or takes a side.
