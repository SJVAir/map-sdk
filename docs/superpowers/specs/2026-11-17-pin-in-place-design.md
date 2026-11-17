# Pin another feature's card in place (`0.1.0-beta.20`)

Approved by the user 2026-11-17.

## Why

A host needs a button inside a pinned card that swaps the card for another plugin's feature,
without moving the camera or releasing a lens. The case: in a `shapesLens` section's card, a
"located in" button opens the parent township's card. With a mouse, the hover lens covers the
township, so a click always lands on a section and the township's card can't be reached
otherwise. `0.1.0-beta.19` has no public way to do it: `pinned` is read-only, `unpin()` only
closes, and `focusFeature` marks list focus and pans.

## Goals

- `MapContext.pin(pluginId, refKey, options?)` pins that feature's card.
- No camera move, no list focus, no selection change, no `featureclick`.
- The lens stays held under the existing rules, plus one new case (below).
- Focus inside the card moves to the new card; WCAG 2.2 AA.
- Hosts that never call `pin` see no change.

Non-goals: a back button or card history; pinning features a plugin doesn't list.

## Approaches

1. **`map.pin(pluginId, refKey, { anchor? })` on `MapContext`** (chosen). Works from any host
   code: a plugin's tooltip content, card actions, or elsewhere.
2. `focusFeature(refKey, pluginId, { pan: false })`: mixes pinning with list focus (`focusedKey`
   drives the list row and the card's priority), so it would mark a row the person never focused.
3. A method on `CardContext`: only card actions get it, and the case's button sits in the
   plugin's tooltip content.

## Design

### `pin`

```ts
pin(pluginId: string, refKey: string, options?: { anchor?: [number, number] }): boolean;
```

- Returns `true` when it pinned. Refuses (`false`, nothing changes) when the map is destroyed,
  `MapView`'s `card` is off, the plugin isn't on the map, it is `hoverable: false`, or its
  `features()` don't list `refKey`.
- Sets `pinned` to `{ hit: { pluginId, ref, refKey, name }, lngLat }` from the listed item.
- `lngLat`: `options.anchor` when given; else the open pinned card's `lngLat` (the card stays
  where it is: "in place"); else `anchorFor(item)` (the item's point, or a point of the shape in
  view). Works while detached too: with no GL map, `anchorFor` falls back to the item's `lngLat`.
- Leaves `focusedKey`, `focusedPluginId`, `focusedAnchor`, selections and the camera alone, and
  emits no `featureclick`.
- While a list row is keyboard-focused, the focused item still wins the card (as now); `pin` sets
  `pinned`, which shows once the focus clears. Documented, not special-cased.

### The lens

- A lens pinned with `shapesLens.pin(refKey)`: unchanged. A card on a parent in the block, as the
  swap gives, already keeps it.
- A hover lens: today a card on a child (section) or on another plugin's feature inside the
  block (a notice) holds it; a parent's (township's) card doesn't. New: **a held lens stays held
  when the card moves to its centre parent**, and for as long as that card stays. It is a
  carry-over, not a new way to start a hold: a centre parent's card pinned any other way (list
  focus, a tap with no lens) still doesn't hold, so hosts that don't call `pin` see no change.
  A card moved by list focus (`focusedKey` set) never carries the hold. Closing the card, Esc,
  or a card on another parent or outside the block let go as now. (Refined while planning: a
  plain "a centre parent's card holds" rule changed the list-focus case, which the existing test
  "a pinned card on a parent doesn't pin; on a drawn child it holds" pins.)

### Focus and accessibility

- If focus is inside the card when the pinned feature changes (the swap removes the button that
  had it), focus moves to the card itself (`tabindex="-1"`, the group labelled with the new
  feature's name), so a screen reader announces the new card. Tab then walks its content.
- The card's focus origin (where focus came from before entering the card) is kept, so Close
  and Esc still hand focus back there.
- When focus wasn't inside the card (a mouse click in a browser that doesn't focus buttons),
  focus doesn't move.
- The card shows a visible focus ring when focused this way (`mapsdk-focus`'s ring).
- The button's own name and wording are the host's.

### Docs

README "Changes" (`pin`, the hover-lens hold), the README examples test, CLAUDE.md's core and
lens lines. Version `0.1.0-beta.20` in the same PR.

## Deferrals (the user, 2026-11-17)

Kept deferred, triggers unchanged: the lens's one-frame flash on recentre, the legend status
row's unavailable reason (no legend change here), and the demo page's newer opt-in features.

## Left to the builder

Where in `MapTooltip` the focus move hooks in (keyed on the pinned hit's plugin and refKey,
while `focusInside` or focus was just lost from the card); the test split across client and
browser projects.

## Changed after the final review (2026-11-17)

- **No `anchor` option, and no inherited position.** `MapTooltip` draws a listed item's card at
  the item's own point, so a stored anchor was never drawn, and an inherited one misled the
  lens's `inBlock` test for other plugins' cards. `pin(pluginId, refKey)` now pins at
  `anchorFor(item)`, where a click on the feature would put the card. The card is swapped in
  place of the open one; it may move to the new feature's point.
- **`tabindex="-1"` only for the refocus.** A standing one let a click on the card's text take
  focus, a change for hosts that never call `pin`. The card is focused with
  `mapsdk-focus-outline` (controls.css's ring for script-focused elements), not `mapsdk-focus`.

## The user's decisions after the review (2026-11-17)

- **Exactly in place.** `pin` keeps the card at the open card's drawn point (`pinned.inPlace`,
  which `MapTooltip` draws at `lngLat`) when that point lies on the new feature's shape
  (`containsPoint`); otherwise it pins at `anchorFor(item)`. So a section's card swapped for its
  township's doesn't move, and a card for a feature elsewhere never claims the old spot (the
  lens's `inBlock` test reads a truthful point). This replaces the first change above.
- **A hover lens's section card shows its body.** New optional `MapPlugin.itemFor(refKey)`: the
  item for a drawn but unlisted feature. `shapesLens` gives its drawn children's items, so their
  tooltip and card show the `tooltip` content under a hover lens too (beta.17–19 showed only the
  name and actions). The list is unchanged.
- **The review's minors, fixed.** Focus moves to the card only for a swap a click or key inside
  the card caused (not a `pin` from host code elsewhere); pinning the feature already pinned is a
  no-op; the README examples test covers a successful `pin`.
