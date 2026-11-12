import type { Snippet } from "svelte";
import type { FeatureListItem } from "../core/plugin.js";
import type { FeatureRef } from "../data/types.js";

/** What a host's card actions get: the card's feature and its selection state. */
export interface CardContext {
	pluginId: string;
	ref: FeatureRef;
	refKey: string;
	/** The listed item, or null for a hit its plugin doesn't list (an HMS fire hotspot). */
	item: FeatureListItem | null;
	/** Whether the feature is in its plugin's selection. Reactive. */
	selected: boolean;
	/** A user's Select/Remove: toggles the feature, with the plugin's `canSelect`. */
	toggle(): void;
}

/** `MapView`'s `card` options. */
export interface CardOptions {
	/** The host's buttons, in a row at the card's foot. */
	actions?: Snippet<[CardContext]>;
}
