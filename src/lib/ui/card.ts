import type { Snippet } from "svelte";
import type { FeatureListItem } from "../core/plugin.js";
import type { FeatureRef } from "../data/types.js";

/** What a host's card actions get: the card's feature and its selection state. */
export interface CardContext {
	readonly pluginId: string;
	readonly ref: FeatureRef;
	readonly refKey: string;
	/** The listed item, or null for a hit its plugin doesn't list (an HMS fire hotspot). */
	readonly item: FeatureListItem | null;
	/**
	 * Whether the feature can be selected: its plugin's mode isn't `"none"`, it's a monitor or a
	 * region (not a `feature` ref), and its listed item, if any, is `selectable`. Reactive. Show
	 * Select/Remove only when it's true.
	 */
	readonly selectable: boolean;
	/** Whether the feature is in its plugin's selection. Reactive. */
	readonly selected: boolean;
	/**
	 * A user's Select/Remove: toggles the feature, with the plugin's `canSelect`. Does nothing
	 * when it isn't `selectable`.
	 */
	toggle(): void;
}

/** `MapView`'s `card` options. */
export interface CardOptions {
	/** The host's buttons, in a row at the card's foot. */
	actions?: Snippet<[CardContext]>;
}
