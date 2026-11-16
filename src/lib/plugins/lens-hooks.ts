import type { MapPlugin } from "../core/plugin.js";

/** Where a `shapesPlugin` keeps the hooks a lens over it uses. Internal to map-sdk. */
export const LENS_PARENT: unique symbol = Symbol("mapsdk:lens-parent");

/** What a lens (`shapesLens`) needs from the shapes it opens. */
export interface LensParentHooks {
	readonly choropleth: boolean;
	/** Reactive: inside its zoom range (true without one). */
	readonly shown: boolean;
	/** Reactive: the parents' refKeys in the latest data. */
	readonly keys: ReadonlySet<string>;
	/**
	 * Draws these parents' fill (and level outline) transparent, by the `lensHidden` feature state.
	 * The paint gains the case the first time a non-empty set comes; until then it's unchanged.
	 * Kept across data reloads and restyles.
	 */
	setHidden(keys: ReadonlySet<string>): void;
}

/** The lens hooks of a `shapesPlugin`, or null for any other plugin. */
export function lensParentOf(plugin: MapPlugin): LensParentHooks | null {
	return (plugin as { [LENS_PARENT]?: LensParentHooks })[LENS_PARENT] ?? null;
}
