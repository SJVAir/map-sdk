/**
 * Whether a click was a touch tap, from the click's own `pointerType` and the `pointerType` of
 * the `pointerdown` recorded for the same press (cleared on each click and on `pointercancel`).
 *
 * - The recorded press wins over the click's own type: iOS Safari since 18.2 dispatches a tap's
 *   `click` with `pointerType: "mouse"`, while its `pointerdown` says `"touch"` (WebKit bug
 *   282988).
 * - A click with no `pointerType` at all (Safari before 17 dispatches `click` as a `MouseEvent`)
 *   takes the recorded press.
 * - A click whose `pointerType` is `""` is never a tap, whatever an earlier press left recorded:
 *   Chrome and Firefox send that for `element.click()` and keyboard activation. (Safari's type
 *   for those is unverified.)
 */
export function isTouchClick(own: string | undefined, recorded: string | null): boolean {
	if (own === "") return false;
	return (recorded ?? own) === "touch";
}
