import { untrack } from "svelte";
import type { Hovered, OwnHover } from "../core/interactions.svelte.js";

/** What the lens's rules read. Every method is reactive. */
export interface LensInputs {
	/** The parents' plugin id. */
	readonly parentsId: string;
	/** The lens's own plugin id (its drawn children's hits). */
	readonly lensId: string;
	/** The parents' own feature under the pointer (`PluginContext.hoverOf`). */
	parent(): OwnHover | null;
	/** The lens's own drawn child under the pointer. */
	child(): OwnHover | null;
	/** A drawn child's parent refKey, or null. */
	childParent(refKey: string): string | null;
	/** `lngLat` lies inside a drawn child or a parent of the current block. */
	inBlock(lngLat: [number, number]): boolean;
	/** `refKey` is one of the current block's parents. */
	blockHas(refKey: string): boolean;
	pinnedCard(): Hovered | null;
	pointerInCard(): boolean;
	/** The parents are set up and inside their zoom range. */
	inRange(): boolean;
	/** The parents' refKeys in their latest data. */
	parentKeys(): ReadonlySet<string>;
}

/**
 * The lens's rules (the Pesticides Explorer's hover; the dashboard's pinning): which parent it's
 * centred on, whether it's pinned, and the grace before it drops. No GL: `shapesLens` draws it.
 */
export function createLensState(inputs: LensInputs, graceMs = 120) {
	let center = $state<string | null>(null);
	let pinned = $state(false);
	let held = $state(false);
	/**
	 * After Esc or a release: these parents (the old centre, and the one under the pointer then)
	 * don't raise the lens again until the hover moves to another one, or off.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
	const suppressed = new Set<string>();
	/** The parent under the pointer at the last run. */
	let lastTarget: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** The pinned card's key at the last run, to see a card close while pinned. */
	let lastCard: string | null = null;

	const cancel = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
	/** `suppress`: the old centre, plus the parent under the pointer with `"pointer"`. */
	const drop = (suppress: false | "center" | "pointer") => {
		cancel();
		if (suppress) {
			suppressed.clear();
			if (center !== null) suppressed.add(center);
			if (suppress === "pointer" && lastTarget !== null) suppressed.add(lastTarget);
		}
		center = null;
		pinned = false;
	};

	/** The card belongs to the lens: a drawn child, a parent of the block, or a feature inside it. */
	const cardInLens = (card: Hovered | null): boolean => {
		if (card === null) return false;
		if (card.hit.pluginId === inputs.lensId) return true;
		if (card.hit.pluginId === inputs.parentsId) return inputs.blockHas(card.hit.refKey);
		return inputs.inBlock(card.lngLat);
	};
	const isChildCard = (card: Hovered | null): boolean =>
		card !== null && card.hit.pluginId !== inputs.parentsId && cardInLens(card);

	function run(): void {
		const parent = inputs.parent();
		const child = inputs.child();
		const inCard = inputs.pointerInCard();
		const shown = inputs.inRange();
		const keys = inputs.parentKeys();
		const card = inputs.pinnedCard();
		untrack(() => {
			const fromMouse = (h: OwnHover | null) => (h && !h.touch ? h : null);
			const overChild = fromMouse(child);
			const overParent = fromMouse(parent);
			const target = overChild
				? (inputs.childParent(overChild.hit.refKey) ?? overParent?.hit.refKey ?? null)
				: (overParent?.hit.refKey ?? null);
			lastTarget = target;
			const cardKey = card ? `${card.hit.pluginId}\n${card.hit.refKey}` : null;
			const cardChanged = cardKey !== lastCard;
			lastCard = cardKey;
			if (!shown || (center !== null && !keys.has(center))) {
				drop(false);
				held = false;
				return;
			}
			if (pinned) {
				held = false;
				// Only a change of card lets go: a card already pinned when `pin` came stays accepted.
				if (!cardChanged || (card !== null && cardInLens(card))) return;
				// Closed, or moved outside the block: the hover takes over at once (the old centre
				// stays down until the pointer leaves it).
				drop("center");
			}
			// A pinned card on a child (or a feature inside the block) keeps the lens where it is, so
			// the card's feature doesn't vanish under it.
			held = center !== null && isChildCard(card);
			if (target === null || !suppressed.has(target)) suppressed.clear();
			if (target !== null && suppressed.has(target)) return;
			if (target !== null) {
				cancel();
				if (!held && keys.has(target)) center = target;
				return;
			}
			if (inCard || held) {
				cancel();
				return;
			}
			if (center !== null && timer === null) {
				timer = setTimeout(() => {
					timer = null;
					if (!pinned) center = null;
				}, graceMs);
			}
		});
	}

	return {
		/** Reactive: the parent the lens is centred on, or null. */
		get center(): string | null {
			return center;
		},
		/** Reactive: pinned by `pin`. */
		get pinned(): boolean {
			return pinned;
		},
		/** Reactive: held in place by a pinned card on a child or a feature inside the block. */
		get held(): boolean {
			return held;
		},
		/** Refused while the parents are out of range or `refKey` isn't one of them. */
		pin(refKey: string): void {
			if (!untrack(() => inputs.inRange()) || !untrack(() => inputs.parentKeys()).has(refKey))
				return;
			cancel();
			suppressed.clear();
			center = refKey;
			pinned = true;
			// The card pinned now (the township's, whose button called this) is accepted.
			const card = untrack(() => inputs.pinnedCard());
			lastCard = card ? `${card.hit.pluginId}\n${card.hit.refKey}` : null;
		},
		release(): void {
			drop("pointer");
		},
		/** Esc: drops an unpinned lens (until the hover changes) and releases a pinned one. */
		escape(): void {
			if (center !== null) drop("pointer");
		},
		start(): () => void {
			const stop = $effect.root(() => {
				$effect(run);
			});
			// A pinned lens outlives a teardown (a restyle sets it up again); a hover lens doesn't.
			return () => {
				stop();
				cancel();
				if (!pinned) center = null;
				held = false;
				suppressed.clear();
				lastCard = null;
				lastTarget = null;
			};
		}
	};
}
