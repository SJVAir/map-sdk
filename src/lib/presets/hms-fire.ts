import type { MapPlugin } from "../core/plugin.js";
import { scopedContext } from "../core/scoped-context.js";
import type { DataSource, FireFeatureProperties } from "../data/types.js";
import { fireIcon } from "../plugins/icons.js";
import { pointsPlugin } from "../plugins/points.svelte.js";
import FireTooltip from "./FireTooltip.svelte";
import { componentSnippet } from "./monitors.js";

export interface HmsFirePluginOptions {
	/** Default "hms-fire". */
	id?: string;
	/**
	 * The fires, or with `hotspots` the groups shown below zoom 10 (listed). A feature with a
	 * `count` is a group (its tooltip says "Average" from 2 detections); one without is a single
	 * detection.
	 */
	source: DataSource<FireFeatureProperties>;
	/** Single detections shown from zoom 10 instead of `source` (not listed). Default: none. */
	hotspots?: DataSource<FireFeatureProperties>;
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
	source: DataSource<FireFeatureProperties>,
	layerLabel: string,
	zoomRange?: { min?: number; max?: number }
): MapPlugin {
	return pointsPlugin({
		id,
		source,
		layerLabel,
		selectable: false,
		zoomRange,
		legendDisplay: "blocks",
		truncateValues: true,
		tooltipShowsName: true,
		tooltip: (item, props, env) =>
			componentSnippet(FireTooltip, {
				item,
				count: typeof props.count === "number" ? props.count : null,
				messages: env.messages,
				format: env.format
			}),
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
 * (each detection) from zoom 10. Both are hit-tested and show the same tooltip: the power in a
 * reading box colored by its level, beside the name and level; only the groups are listed. Values
 * are cut off at the display precision, not rounded, in the tooltip, list, and accessible names.
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
	const singles = firePoints(id, hotspots, layerLabel, { min: HOTSPOT_ZOOM });
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
		// Only the groups are listed; a hovered hotspot shows the same box as a group.
		features: groups.features,
		tooltip: groups.tooltip,
		tooltipShowsName: true,
		hoverTooltip(hit) {
			const item = singles.features?.().find((f) => f.refKey === hit.refKey);
			return item && singles.tooltip?.(item);
		}
	};
}
