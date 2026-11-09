import type { Bounds } from "../core/create-map.svelte.js";
import { intersectsBounds } from "../core/shape-view.js";
import type { FeatureListItem } from "../core/plugin.js";
import type { FormatProvider } from "../data/format.js";
import type { MessageProvider } from "../data/messages.js";
import { NO_LEVEL } from "../data/scale.js";
import type { Level } from "../data/scale-types.js";
import { formatValue } from "./value-format.js";

export type { Bounds };
export type SortBy = "name" | "value";

/**
 * How long after Shift+F10 or the Menu key the browser's own keyboard `contextmenu` event (sent on
 * keydown or keyup, depending on the platform) is treated as a duplicate of the one sent to the row.
 */
export const MENU_EVENT_WINDOW_MS = 1000;

/**
 * A valid, stable id fragment for a row, from its plugin and refKey: anything but letters and digits
 * is escaped as `_<hex>_` (`_` and `-` included), so the `--` between the parts can only be the
 * separator and different rows never share a fragment.
 */
export function optionIdPart(pluginId: string, refKey: string): string {
	const escape = (text: string) =>
		text.replace(/[^A-Za-z0-9]/g, (c) => `_${c.codePointAt(0)!.toString(16)}_`);
	return `${escape(pluginId)}--${escape(refKey)}`;
}

/**
 * Items in `bounds`, edges included: a shape (`geometry`) when it overlaps them, anything else when
 * its point is inside. No antimeridian handling (the Valley).
 */
export function inView(items: FeatureListItem[], bounds: Bounds): FeatureListItem[] {
	return items.filter((item) => intersectsBounds(item, bounds));
}

/**
 * The item's level, or null for `NO_LEVEL`. A level with an empty color is still shown, by its
 * label on a neutral swatch.
 */
export function shownLevel(item: FeatureListItem): Level | null {
	return item.level !== NO_LEVEL ? item.level : null;
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

/**
 * What stands in an item's level place: its level's label, else its `detail`, else "No level".
 */
export function levelText(
	item: FeatureListItem,
	messages: MessageProvider
): { kind: "level" | "detail" | "none"; text: string } {
	const level = shownLevel(item);
	if (level) return { kind: "level", text: level.label };
	const detail = item.detail?.trim();
	if (detail) return { kind: "detail", text: detail };
	return { kind: "none", text: messages("mapsdk_no_level") };
}

/** A row's accessible name: name, value, units, and level label (or detail). */
export function rowLabel(
	item: FeatureListItem,
	messages: MessageProvider,
	format: FormatProvider
): string {
	const level = levelText(item, messages);
	if (item.value === null) {
		return level.kind === "detail"
			? messages("mapsdk_list_row_detail", { name: item.name, detail: level.text })
			: messages("mapsdk_list_row_no_value", { name: item.name });
	}
	const params = {
		name: item.name,
		value:
			typeof item.value === "number"
				? formatValue(item.value, item.precision, format, item.truncate)
				: item.value,
		units: item.units,
		level: level.text
	};
	return messages(item.units ? "mapsdk_list_row" : "mapsdk_list_row_no_units", params);
}
