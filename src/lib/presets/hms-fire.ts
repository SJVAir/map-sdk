import type { MapPlugin } from "../core/plugin.js";
import type { DataSource } from "../data/types.js";
import { fireIcon } from "../plugins/icons.js";
import { pointsPlugin } from "../plugins/points.svelte.js";

export interface HmsFirePluginOptions {
	/** Default "hms-fire". */
	id?: string;
	source: DataSource;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
}

/** Icon size in pixels by level index, smallest to largest (presentation). */
const SIZES = [20, 24, 28, 32, 36];
const CANVAS = SIZES[SIZES.length - 1];

/** The fire glyph at the size for a level index, centered on a fixed canvas. */
function drawFire(color: string, levelIndex = -1): string {
	const size = SIZES[Math.min(Math.max(levelIndex, 0), SIZES.length - 1)];
	const offset = (CANVAS - size) / 2;
	return `<svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${offset} ${offset})">${fireIcon(color, size)}</g></svg>`;
}

/**
 * NOAA HMS fire detections as flame icons colored by fire radiative power (MW) and growing with
 * its level. Not selectable; listed.
 *
 * The source's `scale` is expected to be the ScaleRef
 * `{ dataset: "hms-fire", entryType: "fire-frp" }`, and each feature's `value` its FRP. Pass groups
 * from `groupFires` (value = `avgFrp`) to merge nearby detections. This preset does not fetch.
 */
export function hmsFirePlugin(options: HmsFirePluginOptions): MapPlugin {
	return pointsPlugin({
		id: options.id ?? "hms-fire",
		source: options.source,
		layerLabel: options.layerLabel,
		selectable: false,
		icon: {
			category: () => "fire",
			draw: (_category, color, _theme, levelIndex) => drawFire(color, levelIndex),
			size: CANVAS
		}
	});
}
