import type { MapPlugin } from "../core/plugin.js";
import type { DataSource } from "../data/types.js";
import { shapesPlugin } from "../plugins/shapes.svelte.js";

export interface RegionsPluginOptions {
	/** Default "regions". */
	id?: string;
	source: DataSource;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	/** Default true. */
	selectable?: boolean;
}

/**
 * Region polygons (counties, cities, and other server regions) filled by a pollutant's level.
 *
 * The source's `scale` is expected to be the ScaleRef
 * `{ dataset: "air-quality", entryType: <pollutant> }, e.g. `pm25``.
 *
 * This preset does not fetch. The host's data source supplies the features, and each feature's
 * `refKey` must already be `region:<type>:<external_id>`: a region of any type, e.g. `region:county:fresno`. Use the region's `external_id`
 * (its code), never the server's `id` (a sqid), which is not a ref. A picked feature selects
 * `{ kind: "regions", ids: ["<type>:<code>"] }`.
 */
export function regionsPlugin(options: RegionsPluginOptions): MapPlugin {
	return shapesPlugin({
		id: options.id ?? "regions",
		source: options.source,
		layerLabel: options.layerLabel,
		mode: "choropleth",
		selectable: options.selectable ?? true
	});
}
