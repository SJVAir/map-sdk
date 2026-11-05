import type { MapPlugin } from "../core/plugin.js";
import { scopedContext } from "../core/scoped-context.js";
import type { DataSource } from "../data/types.js";
import { fireIcon } from "../plugins/icons.js";
import { pointsPlugin } from "../plugins/points.svelte.js";

export interface HmsFirePluginOptions {
	/** Default "hms-fire". */
	id?: string;
	/** The fires, or with `hotspots` the groups shown below zoom 10 (listed). */
	source: DataSource;
	/** Single detections shown from zoom 10 instead of `source` (not listed). Default: none. */
	hotspots?: DataSource;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
}

/** The zoom where `hotspots` replace the groups (inclusive), as sjvair.com's map does. */
const HOTSPOT_ZOOM = 10;

/** Icon size in pixels by level index, smallest to largest (presentation). */
const SIZES = [20, 24, 28, 32, 36];
const CANVAS = SIZES[SIZES.length - 1];

/** The fire glyph at the size for a level index, centered on a fixed canvas. */
function drawFire(color: string, levelIndex = -1): string {
	const size = SIZES[Math.min(Math.max(levelIndex, 0), SIZES.length - 1)];
	const offset = (CANVAS - size) / 2;
	return `<svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${offset} ${offset})">${fireIcon(color, size)}</g></svg>`;
}

function firePoints(
	id: string,
	source: DataSource,
	layerLabel: string,
	zoomRange?: { min?: number; max?: number },
	listed = true
): MapPlugin {
	return pointsPlugin({
		id,
		source,
		layerLabel,
		selectable: false,
		zoomRange,
		listed,
		legendDisplay: "blocks",
		icon: {
			category: () => "fire",
			draw: (_category, color, _theme, levelIndex) => drawFire(color, levelIndex),
			size: CANVAS
		}
	});
}

/**
 * NOAA HMS fire detections as flame icons colored by fire radiative power (MW) and growing with
 * its level. Not selectable; `source`'s fires are listed.
 *
 * With `hotspots`, it is still one layer (one legend section, one list) that switches by itself
 * while zooming: `source` (groups from `groupFires`, value = `avgFrp`) below zoom 10, `hotspots`
 * (each detection) from zoom 10. Both are hit-tested and show tooltips; only the groups are listed.
 *
 * The sources' `scale` is expected to be the ScaleRef `{ dataset: "hms-fire", entryType:
 * "fire-frp" }`, and each feature's `value` its FRP. This preset does not fetch.
 */
export function hmsFirePlugin(options: HmsFirePluginOptions): MapPlugin {
	const id = options.id ?? "hms-fire";
	const { source, hotspots, layerLabel } = options;
	if (!hotspots) return firePoints(id, source, layerLabel);
	// Both inner plugins share the outer id, so their hits are this plugin's.
	const groups = firePoints(id, source, layerLabel, { max: HOTSPOT_ZOOM });
	const singles = firePoints(id, hotspots, layerLabel, { min: HOTSPOT_ZOOM }, false);
	return {
		id,
		label: layerLabel,
		get dataset() {
			return groups.dataset;
		},
		selectable: false,
		setup(ctx) {
			const teardownGroups = groups.setup(scopedContext(ctx, "groups:"));
			const teardownSingles = singles.setup(scopedContext(ctx, "hotspots:"));
			return () => {
				teardownSingles();
				teardownGroups();
			};
		},
		legend: groups.legend,
		features: groups.features
	};
}
