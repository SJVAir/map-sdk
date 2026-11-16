import type { Hovered, OwnHover } from "../../src/lib/core/interactions.svelte.js";
import type { LensInputs } from "../../src/lib/plugins/lens-state.svelte.js";

/** A hover on `refKey` of `pluginId`. */
export function hover(
	pluginId: string,
	refKey: string,
	touch = false,
	lngLat: [number, number] = [0, 0]
): OwnHover {
	return {
		hit: { pluginId, refKey, name: refKey, ref: { kind: "feature", id: refKey } },
		lngLat,
		touch
	};
}

/** Settable lens inputs: parents "parents", children "lens"; a child's parent is its key minus "-Sn". */
export class FakeLensInputs implements LensInputs {
	readonly parentsId = "parents";
	readonly lensId = "lens";
	parentHover = $state.raw<OwnHover | null>(null);
	childHover = $state.raw<OwnHover | null>(null);
	card = $state.raw<Hovered | null>(null);
	focus = $state<string | null>(null);
	inCard = $state(false);
	shown = $state(true);
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never mutated
	keys = $state.raw<ReadonlySet<string>>(new Set(["T1", "T2", "T3"]));
	/** lngLat x inside the block (a crude stand-in for the geometry test). */
	blockX = $state(10);

	parent() {
		return this.parentHover;
	}
	child() {
		return this.childHover;
	}
	childParent(refKey: string) {
		return refKey.replace(/-S\d+$/, "");
	}
	inBlock(lngLat: [number, number]) {
		return lngLat[0] < this.blockX;
	}
	pinnedCard() {
		return this.card;
	}
	focusedKey() {
		return this.focus;
	}
	pointerInCard() {
		return this.inCard;
	}
	inRange() {
		return this.shown;
	}
	parentKeys() {
		return this.keys;
	}
}
