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
	pinnedCard(): Hovered | null;
	focusedKey(): string | null;
	pointerInCard(): boolean;
	/** The parents are inside their zoom range. */
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
	/** After Esc (or a release under the pointer): this parent doesn't raise it again until the hover changes. */
	let suppressed: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** The pinned card's key at the last run, to see a card close while pinned. */
	let lastCard: string | null = null;

	const cancel = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};
	const drop = (suppress: boolean) => {
		cancel();
		if (suppress && center !== null) suppressed = center;
		center = null;
		pinned = false;
	};

	/** The card (or focused item) belongs to the lens: a drawn child, or a feature inside the block. */
	const cardInLens = (card: Hovered | null): boolean =>
		card !== null && (card.hit.pluginId === inputs.lensId || inputs.inBlock(card.lngLat));
	const isChildCard = (card: Hovered | null): boolean =>
		card !== null && card.hit.pluginId !== inputs.parentsId && cardInLens(card);

	function run(): void {
		const parent = inputs.parent();
		const child = inputs.child();
		const inCard = inputs.pointerInCard();
		const shown = inputs.inRange();
		const keys = inputs.parentKeys();
		const card = inputs.pinnedCard();
		const focus = inputs.focusedKey();
		untrack(() => {
			const cardKey = card ? `${card.hit.pluginId}\n${card.hit.refKey}` : null;
			const cardClosed = lastCard !== null && cardKey === null;
			lastCard = cardKey;
			if (!shown || (center !== null && !keys.has(center))) {
				drop(false);
				held = false;
				return;
			}
			if (pinned) {
				held = false;
				if (cardClosed || (card !== null && !cardInLens(card))) drop(true);
				return;
			}
			// A pinned card on a child (or a feature inside the block) keeps the lens where it is, so
			// the card's feature doesn't vanish under it. A focused child does too.
			held =
				center !== null && (isChildCard(card) || (focus !== null && child?.hit.refKey === focus));
			const fromMouse = (h: OwnHover | null) => (h && !h.touch ? h : null);
			const overChild = fromMouse(child);
			const overParent = fromMouse(parent);
			const target = overChild
				? (inputs.childParent(overChild.hit.refKey) ?? overParent?.hit.refKey ?? null)
				: (overParent?.hit.refKey ?? null);
			if (suppressed !== null && target !== suppressed) suppressed = null;
			if (target !== null && target === suppressed) return;
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
		pin(refKey: string): void {
			cancel();
			suppressed = null;
			center = refKey;
			pinned = true;
		},
		release(): void {
			drop(true);
		},
		/** Esc: drops an unpinned lens (until the hover changes) and releases a pinned one. */
		escape(): void {
			if (center !== null) drop(true);
		},
		start(): () => void {
			const stop = $effect.root(() => {
				$effect(run);
			});
			return () => {
				stop();
				cancel();
				center = null;
				pinned = false;
				held = false;
				suppressed = null;
				lastCard = null;
			};
		}
	};
}
