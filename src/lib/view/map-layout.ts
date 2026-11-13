import { getContext, setContext } from "svelte";

/** What `MapView` tells the pieces drawn over it (the options toolbar) about the map's box. */
export interface MapLayout {
	/** The map's box is at least 48rem wide (the toolbar's wide layout). */
	readonly wide: boolean;
	/** The map's box on the page, or null before it's mounted. */
	box(): DOMRect | null;
	/** The toolbar's bar, measured for `--mapsdk-toolbar-height` and the List button (null: gone). */
	setBar(bar: Element | null): void;
	/** While the narrow panel covers the map, everything else in it is inert. */
	setCovered(covered: boolean): void;
}

const KEY = Symbol("mapsdk-map-layout");

export function setMapLayout(layout: MapLayout): void {
	setContext(KEY, layout);
}

/** The enclosing `MapView`'s layout, or undefined outside one. */
export function getMapLayout(): MapLayout | undefined {
	return getContext<MapLayout | undefined>(KEY);
}

/** monitor-map's breakpoint, Tailwind's `md`: 48rem at the page's root font size. */
export function isWideWidth(width: number): boolean {
	const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	return width >= 48 * rem;
}
