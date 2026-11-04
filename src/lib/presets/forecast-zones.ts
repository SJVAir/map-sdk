import type { MapPlugin } from "../core/plugin.js";
import type { DataSource } from "../data/types.js";
import { shapesPlugin } from "../plugins/shapes.svelte.js";

export interface ForecastZonesPluginOptions {
	/** Default "forecast-zones". */
	id?: string;
	source: DataSource;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
	/** Default true. */
	selectable?: boolean;
}

/**
 * Air quality forecast zones filled by the forecast's AQI level.
 *
 * The source's `scale` is expected to be the ScaleRef
 * `{ dataset: "forecasts", entryType: "aqi-forecast" }`.
 *
 * This preset does not fetch. The host's data source supplies the features, and each feature's
 * `refKey` must already be `region:<type>:<external_id>`: a county region (`region:county:<code>`) for most zones and a `custom` region for the rest (e.g. `region:custom:sjvapcd-kern-airbasin`). Use the region's `external_id`
 * (its code), never the server's `id` (a sqid), which is not a ref. A picked feature selects
 * `{ kind: "regions", ids: ["<type>:<code>"] }`.
 */
export function forecastZonesPlugin(options: ForecastZonesPluginOptions): MapPlugin {
	return shapesPlugin({
		id: options.id ?? "forecast-zones",
		source: options.source,
		layerLabel: options.layerLabel,
		mode: "choropleth",
		selectable: options.selectable ?? true
	});
}
