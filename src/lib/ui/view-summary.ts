import type { FeatureListItem } from "../core/plugin.js";
import type { MessageProvider } from "../data/messages.js";
import type { Scale } from "../data/scale-types.js";
import { shownLevel } from "./feature-list.js";

const list = new Intl.ListFormat("en-US", { type: "unit" });

/**
 * One line describing the listed features: the layer, then how many are at each level, in the
 * scale's order, zero counts left out (items with no level to show come last). With no scale, or
 * nothing counted, just the count and layer.
 */
export function summaryText(
	layerLabel: string,
	items: FeatureListItem[],
	scale: Scale | null,
	messages: MessageProvider
): string {
	const plain = () => messages("mapsdk_summary", { count: items.length, layer: layerLabel });
	if (!scale || items.length === 0) return plain();
	const counts = new Map<string, number>();
	let none = 0;
	for (const item of items) {
		const level = shownLevel(item);
		if (level && scale.levels.some((l) => l.key === level.key)) {
			counts.set(level.key, (counts.get(level.key) ?? 0) + 1);
		} else {
			none++;
		}
	}
	const parts = scale.levels.flatMap((level) => {
		const count = counts.get(level.key);
		return count ? [messages("mapsdk_summary_level", { count, level: level.label })] : [];
	});
	if (none > 0) {
		parts.push(
			messages("mapsdk_summary_level", { count: none, level: messages("mapsdk_no_level") })
		);
	}
	return messages("mapsdk_summary_with_levels", { layer: layerLabel, levels: list.format(parts) });
}

/** How long after the last camera move or selection change the live region is updated. */
export const SUMMARY_DEBOUNCE_MS = 750;
