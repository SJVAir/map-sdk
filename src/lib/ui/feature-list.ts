import type { Bounds } from "../core/create-map.svelte.js";
import type { FeatureListItem } from "../core/plugin.js";
import type { FormatProvider } from "../data/format.js";
import type { MessageProvider } from "../data/messages.js";
import { NO_LEVEL } from "../data/scale.js";
import type { Level } from "../data/scale-types.js";

export type { Bounds };
export type SortBy = "name" | "value";

/**
 * How long after Shift+F10 or the Menu key the browser's own keyboard `contextmenu` event (sent on
 * keydown or keyup, depending on the platform) is treated as a duplicate of the one sent to the row.
 */
export const MENU_EVENT_WINDOW_MS = 1000;

/**
 * A valid, stable id fragment for a row, from its plugin and refKey: anything but letters, digits,
 * and `-` is escaped as `_<hex>_` (`_` included), so different rows never share one.
 */
export function optionIdPart(pluginId: string, refKey: string): string {
	const escape = (text: string) =>
		text.replace(/[^A-Za-z0-9-]/g, (c) => `_${c.codePointAt(0)!.toString(16)}_`);
	return `${escape(pluginId)}--${escape(refKey)}`;
}

/** Items whose point is inside `bounds`, edges included. No antimeridian handling (the Valley). */
export function inView(items: FeatureListItem[], bounds: Bounds): FeatureListItem[] {
	return items.filter(({ lngLat: [lng, lat] }) => {
		return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
	});
}

/** The item's level if it has one to show: a level with an empty color reads as no level. */
export function shownLevel(item: FeatureListItem): Level | null {
	return item.level !== NO_LEVEL && item.level.color ? item.level : null;
}

const collator = new Intl.Collator("en-US");

/** A value's sort weight; `null` sorts last. Category values sort by their level's tier. */
function weight(item: FeatureListItem): number | null {
	if (item.value === null || item.level === NO_LEVEL) return null;
	if (typeof item.value === "number") return item.value;
	return item.level.tier ?? null;
}

/** A sorted copy. `value`: highest first, null values and no level last; ties and `name` by name. */
export function sortItems(items: FeatureListItem[], by: SortBy): FeatureListItem[] {
	const byName = (a: FeatureListItem, b: FeatureListItem) => collator.compare(a.name, b.name);
	if (by === "name") return items.toSorted(byName);
	const weighted = items.map((item) => ({ item, w: weight(item) }));
	weighted.sort((a, b) => {
		if (a.w === null || b.w === null) {
			if (a.w !== b.w) return a.w === null ? 1 : -1;
		} else if (a.w !== b.w) {
			return b.w - a.w;
		}
		return byName(a.item, b.item);
	});
	return weighted.map(({ item }) => item);
}

/** The first index at or after `from` (wrapping) whose name starts with `query`, any case; -1 if none. */
export function typeaheadIndex(items: FeatureListItem[], query: string, from: number): number {
	const q = query.toLocaleLowerCase("en-US");
	const n = items.length;
	for (let step = 0; step < n; step++) {
		const i = (((from + step) % n) + n) % n;
		if (items[i].name.toLocaleLowerCase("en-US").startsWith(q)) return i;
	}
	return -1;
}

/** A row's accessible name: name, value, units, and level label. */
export function rowLabel(
	item: FeatureListItem,
	messages: MessageProvider,
	format: FormatProvider
): string {
	if (item.value === null) return messages("mapsdk_list_row_no_value", { name: item.name });
	const level = shownLevel(item);
	const params = {
		name: item.name,
		value: typeof item.value === "number" ? format.number(item.value) : item.value,
		units: item.units,
		level: level ? level.label : messages("mapsdk_no_level")
	};
	return messages(item.units ? "mapsdk_list_row" : "mapsdk_list_row_no_units", params);
}
