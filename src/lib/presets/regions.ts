import type { MapPlugin } from "../core/plugin.js";
import type { DataSource, MapFeatureProperties } from "../data/types.js";
import { shapesPlugin, type ShapesOptions } from "../plugins/shapes.svelte.js";

export interface RegionsPluginOptions {
	/** Default "regions". */
	id?: string;
	source: DataSource;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	/** Default true. */
	selectable?: boolean;
	/**
	 * A region with no figure (no level on the scale): `"neutral"` (default) fills it in the
	 * neutral color; `"outline"` draws it as an outline with no fill, and the Legend adds a
	 * "No data" row while any shows. See `shapesPlugin`.
	 */
	noFigure?: ShapesOptions<MapFeatureProperties>["noFigure"];
	/** Fill opacity where a level sets none. Default 0.6. */
	fillOpacity?: number;
	/** The regions' edge: `"theme"` (default), `"level"` or `"none"`. See `shapesPlugin`. */
	outline?: ShapesOptions<MapFeatureProperties>["outline"];
}

/**
 * Region polygons (counties, cities, and other server regions) filled by a pollutant's level.
 *
 * The source's `scale` is expected to be the ScaleRef
 * `{ dataset: "air-quality", entryType: <pollutant> }` (e.g. `pm25`).
 *
 * This preset does not fetch. The host's data source supplies the features, and each feature's
 * `refKey` must already be `region:<type>:<external_id>`: a region of any type, e.g.
 * `region:county:fresno`. Use the region's `external_id` (its code), never the server's `id` (a
 * sqid), which is not a ref. A picked feature selects
 * `{ kind: "regions", ids: ["<type>:<code>"] }`.
 */
export function regionsPlugin(options: RegionsPluginOptions): MapPlugin {
	return shapesPlugin({
		id: options.id ?? "regions",
		source: options.source,
		layerLabel: options.layerLabel,
		mode: "choropleth",
		selectable: options.selectable ?? true,
		noFigure: options.noFigure,
		fillOpacity: options.fillOpacity,
		outline: options.outline
	});
}
