import {
	createMap as createMapContext,
	type CreateMapOptions,
	type MapContext
} from "./core/create-map.svelte.js";
import { defaultBasemaps } from "./view/create-gl-map.js";

export { default as MapView } from "./view/MapView.svelte";
export { default as Legend } from "./ui/Legend.svelte";
export { default as FeatureList } from "./ui/FeatureList.svelte";
export { default as LegendBar } from "./ui/LegendBar.svelte";
export { default as MapTooltip } from "./ui/MapTooltip.svelte";
export { default as SelectionBar } from "./ui/SelectionBar.svelte";
export { default as ViewSummary } from "./ui/ViewSummary.svelte";
export { default as MapControls } from "./ui/MapControls.svelte";
export { legendSection, swatchOverBackground } from "./ui/legend-data.js";
export type { LegendBar as LegendBarData, LegendSection } from "./ui/legend-data.js";
export {
	inView,
	optionIdPart,
	rowLabel,
	shownLevel,
	sortItems,
	typeaheadIndex
} from "./ui/feature-list.js";
export type { SortBy } from "./ui/feature-list.js";
export { summaryText } from "./ui/view-summary.js";
export { getMapContext } from "./core/context.js";
export type { BasemapConfig } from "./core/basemap.svelte.js";
export type {
	Bounds,
	CameraState,
	CreateMapOptions,
	FeatureClickHandler,
	MapConfig,
	MapContext,
	PluginOptions
} from "./core/create-map.svelte.js";

/**
 * Creates a map's state and services; show it with `<MapView map={…} />`. Without
 * `config.basemaps`, the basemaps are MapTiler Streets v4 and its variants, as on today's map.
 */
export function createMap(options: CreateMapOptions): MapContext {
	const basemaps = options.config.basemaps ?? defaultBasemaps();
	return createMapContext({ ...options, config: { ...options.config, basemaps } });
}
