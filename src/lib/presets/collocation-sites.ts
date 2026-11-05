import type { ComponentProps } from "svelte";
import type { MapPlugin } from "../core/plugin.js";
import type { CollocationFeatureProperties, DataSource } from "../data/types.js";
import { CROSSHAIR_ICON_SIZE, withCrosshair } from "../plugins/icons.js";
import { pointsPlugin } from "../plugins/points.svelte.js";
import CollocationTooltip from "./CollocationTooltip.svelte";
import {
	componentSnippet,
	intervalLookup,
	MONITOR_INACTIVE_COLOR,
	MONITOR_INSIDE_OUTLINE,
	monitorShape,
	SHAPES,
	type MonitorShape
} from "./monitors.js";

// Ported from monitor-map 4.3 (src/lib/collocation-sites/): each site drawn at its reference
// monitor, in that monitor's shape and level color, wrapped in a crosshair.

// The user's decision (2026-11-04), an exception to the theme-token rule: the crosshair is this
// blue on every map and theme, as on sjvair.com.
export const COLLOCATION_CROSSHAIR_COLOR = "#4A5FC6";

export interface CollocationSitesPluginOptions {
	/** Default "collocation-sites". */
	id?: string;
	/** Usually `createCollocationSitesStore(…).dataSource`. */
	source: DataSource<CollocationFeatureProperties>;
	/** Already-translated layer name for the list and summary. */
	layerLabel: string;
}

const BORDER_WIDTH = 2;

/** `shape:location`, e.g. "triangle:inside", as the monitors preset's icons. */
function category(props: CollocationFeatureProperties): string {
	return `${monitorShape(props.type)}:${props.location === "inside" ? "inside" : "outside"}`;
}

/**
 * Collocation sites as on today's live map: the reference monitor's marker in a crosshair, with
 * a tooltip of the reference and collocated monitors' readings side by side. Register it before
 * `monitorsPlugin` so it draws under the monitors; its tooltip still wins the hover. Not
 * selectable.
 */
export function collocationSitesPlugin(options: CollocationSitesPluginOptions): MapPlugin {
	const intervalFor = intervalLookup();
	const plugin = pointsPlugin<CollocationFeatureProperties>({
		id: options.id ?? "collocation-sites",
		source: options.source,
		layerLabel: options.layerLabel,
		selectable: false,
		icon: {
			category,
			draw(cat, color) {
				const [shape, location] = cat.split(":") as [MonitorShape, string];
				const marker = SHAPES[shape](
					color,
					BORDER_WIDTH,
					location === "inside" ? MONITOR_INSIDE_OUTLINE : undefined
				);
				return withCrosshair(marker, COLLOCATION_CROSSHAIR_COLOR);
			},
			size: CROSSHAIR_ICON_SIZE,
			muted: (props) => !props.isActive,
			mutedColor: MONITOR_INACTIVE_COLOR
		},
		tooltip: (_item, props, env) =>
			componentSnippet<ComponentProps<typeof CollocationTooltip>>(
				CollocationTooltip,
				Promise.all([
					intervalFor(props.type, env.metadata),
					props.colocatedType
						? intervalFor(props.colocatedType, env.metadata)
						: Promise.resolve(null)
				]).then(([referenceInterval, colocatedInterval]) => ({
					site: props,
					scale: env.scale,
					precision: env.precision,
					messages: env.messages,
					format: env.format,
					referenceInterval,
					colocatedInterval
				}))
			)
	});
	// monitor-map registers the collocation tooltip at the highest priority, over the monitors.
	plugin.hoverPriority = Number.MAX_SAFE_INTEGER;
	return plugin;
}
