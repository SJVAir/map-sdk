import type { MapPlugin } from "../core/plugin.js";
import type { DataSource } from "../data/types.js";
import { shapesPlugin } from "../plugins/shapes.svelte.js";

export interface CalHeatScorePluginOptions {
	/** Default "calheatscore". */
	id?: string;
	source: DataSource;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	/** Default true. */
	selectable?: boolean;
}

/**
 * CalHeatScore ZIP code areas filled by their heat score.
 *
 * The source's `scale` is expected to be the ScaleRef
 * `{ dataset: "calheatscore", entryType: "heat-score" }`.
 *
 * This preset does not fetch. The host's data source supplies the features, and each feature's
 * `refKey` must already be `region:<type>:<external_id>`: a ZIP, `region:zipcode:<zip>`, e.g.
 * `region:zipcode:93721` (`zipcode` is the server's region type name). Use the region's
 * `external_id` (its code), never the server's `id` (a sqid), which is not a ref. A picked
 * feature selects `{ kind: "regions", ids: ["<type>:<code>"] }`.
 */
export function calHeatScorePlugin(options: CalHeatScorePluginOptions): MapPlugin {
	return shapesPlugin({
		id: options.id ?? "calheatscore",
		source: options.source,
		layerLabel: options.layerLabel,
		mode: "choropleth",
		selectable: options.selectable ?? true
	});
}
