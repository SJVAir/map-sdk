import type { MapPlugin } from "../core/plugin.js";
import type { DataSource } from "../data/types.js";
import { shapesPlugin } from "../plugins/shapes.svelte.js";

export interface HmsSmokePluginOptions {
	/** Default "hms-smoke". */
	id?: string;
	source: DataSource;
	/** Already-translated layer name for the legend and summary. */
	layerLabel: string;
}

/**
 * NOAA HMS smoke plumes: polygons filled and outlined (`outline: "level"`) by density, using each
 * level's opacity. Not selectable; listed (each plume a row with its density level), so plumes
 * can be reached without a mouse.
 *
 * The source's `scale` is expected to be the ScaleRef
 * `{ dataset: "hms-smoke", entryType: "smoke-density" }`, and each feature's `value` its density
 * key ("light", "medium", "heavy"). This preset does not fetch.
 */
export function hmsSmokePlugin(options: HmsSmokePluginOptions): MapPlugin {
	return shapesPlugin({
		id: options.id ?? "hms-smoke",
		source: options.source,
		layerLabel: options.layerLabel,
		mode: "choropleth",
		selectable: false,
		outline: "level"
	});
}
