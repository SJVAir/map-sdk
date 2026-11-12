import {
	createMap as createMapContext,
	type CreateMapOptions,
	type MapContext
} from "./core/create-map.svelte.js";
import { defaultBasemaps } from "./view/create-gl-map.js";

export { defaultBasemaps } from "./view/create-gl-map.js";
export { default as MapView } from "./view/MapView.svelte";
export type { FeatureListOptions, ListPosition } from "./view/list-placement.js";
export { default as Legend } from "./ui/Legend.svelte";
export { default as FeatureList } from "./ui/FeatureList.svelte";
export { default as MapTooltip } from "./ui/MapTooltip.svelte";
export { default as SelectionBar } from "./ui/SelectionBar.svelte";
export { default as ViewSummary } from "./ui/ViewSummary.svelte";
export { default as MapControls } from "./ui/MapControls.svelte";
export { legendSection } from "./ui/legend-data.js";
export type { LegendBar as LegendBarData, LegendSection } from "./ui/legend-data.js";
export { rowLabel } from "./ui/feature-list.js";
export type { SortBy } from "./ui/feature-list.js";
export { geometryBbox, intersectsBounds } from "./core/shape-view.js";
export type { Bbox } from "./core/shape-view.js";
export { pointsPlugin } from "./plugins/points.svelte.js";
export type {
	ClusterInfo,
	ClusterLayerArgs,
	PointsOptions,
	PointsTooltipEnv
} from "./plugins/points.svelte.js";
export type { ClusterLayers } from "./plugins/points-clusters.js";
export { colorExpression, levelKeyExpression, opacityExpression } from "./plugins/style.js";
export type { ThemeColors, ValueInput } from "./plugins/style.js";
export { shapesPlugin } from "./plugins/shapes.svelte.js";
export type { ShapesOptions } from "./plugins/shapes.svelte.js";
export { monitorShape, monitorsPlugin } from "./presets/monitors.js";
export type { MonitorShape, MonitorsPluginOptions } from "./presets/monitors.js";
export { regionsPlugin } from "./presets/regions.js";
export type { RegionsPluginOptions } from "./presets/regions.js";
export { focusAreaPlugin } from "./presets/focus-area.svelte.js";
export type {
	FocusAreaPlugin,
	FocusAreaPluginOptions,
	FocusGeometry
} from "./presets/focus-area.svelte.js";
export { calHeatScorePlugin } from "./presets/calheatscore.js";
export type { CalHeatScorePluginOptions } from "./presets/calheatscore.js";
export { forecastZonesPlugin } from "./presets/forecast-zones.js";
export type { ForecastZonesPluginOptions } from "./presets/forecast-zones.js";
export { summaryText } from "./ui/view-summary.js";
export { getMapContext } from "./core/context.js";
// For writing your own plugins.
export type {
	BlockingClick,
	FeatureHit,
	FeatureListItem,
	LayerSpecWithoutId,
	LegendData,
	MapPlugin,
	PluginContext,
	Providers
} from "./core/plugin.js";
export type { GlMapLike } from "./core/gl.js";
export type { CustomLayerInterface } from "@maptiler/sdk";
export type { Hovered } from "./core/interactions.svelte.js";
export type { BasemapConfig } from "./core/basemap.svelte.js";
export type {
	Bounds,
	CameraState,
	CameraTarget,
	CreateMapOptions,
	FeatureClickHandler,
	MapConfig,
	MapContext,
	PluginOptions
} from "./core/create-map.svelte.js";

/**
 * The attached MapTiler `Map`, or `null` while detached: an escape hatch for markers and popups
 * only. The host must never add sources or layers through it; plugins own those.
 */
export function maptilerMap(map: MapContext): import("@maptiler/sdk").Map | null {
	return map.gl as unknown as import("@maptiler/sdk").Map | null;
}

/**
 * Creates a map's state and services; show it with `<MapView map={…} />`. Without
 * `config.basemaps`, the basemaps are MapTiler Streets v4 and its variants, as on today's map.
 */
export function createMap(options: CreateMapOptions): MapContext {
	const basemaps = options.config.basemaps ?? defaultBasemaps();
	return createMapContext({ ...options, config: { ...options.config, basemaps } });
}
export { hmsSmokePlugin } from "./presets/hms-smoke.js";
export type { HmsSmokePluginOptions } from "./presets/hms-smoke.js";
export { hmsFirePlugin } from "./presets/hms-fire.js";
export type { HmsFirePluginOptions } from "./presets/hms-fire.js";
export { cleanFires, groupFires } from "./presets/fire-groups.js";
export type { FireDetection, FireGroup } from "./presets/fire-groups.js";
export {
	collocationSitesPlugin,
	COLLOCATION_CROSSHAIR_COLOR
} from "./presets/collocation-sites.js";
export type { CollocationSitesPluginOptions } from "./presets/collocation-sites.js";
export { circle, CROSSHAIR_ICON_SIZE, square, triangle, withCrosshair } from "./plugins/icons.js";
export type { CardContext, CardOptions } from "./ui/card.js";
