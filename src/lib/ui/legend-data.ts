import { mix } from "color2k";
import type { LegendData } from "../core/plugin.js";
import type { FormatProvider } from "../data/format.js";
import type { DataStatus } from "../data/types.js";

export type LegendBar =
	| { kind: "gradient"; stops: Array<{ color: string; label: string; tick: string }> }
	| {
			kind: "blocks";
			blocks: Array<{ color: string; opacity: number | null; label: string; tick: string }>;
	  };

export interface LegendSection {
	pluginId: string;
	title: string;
	units: string;
	bar: LegendBar;
}

export type LegendEntry =
	| { kind: "scale"; section: LegendSection }
	| {
			kind: "symbols";
			pluginId: string;
			title: string;
			symbols: Array<{ label: string; markup: string }>;
	  }
	| { kind: "status"; pluginId: string; layer: string; status: DataStatus };

/** One legend section from a plugin's legend data; null for status-only data or no levels. */
export function legendSection(data: LegendData, format: FormatProvider): LegendSection | null {
	if (!("scale" in data)) return null;
	const { scale } = data;
	if (scale.levels.length === 0) return null;
	const bar: LegendBar =
		scale.kind === "range" && data.display !== "blocks"
			? {
					kind: "gradient",
					stops: scale.levels.map((level) => ({
						color: level.color ?? "",
						label: level.label,
						tick: level.min === null ? "" : format.number(Math.floor(level.min))
					}))
				}
			: {
					kind: "blocks",
					blocks: scale.levels.map((level) => ({
						color: level.color ?? "",
						opacity: level.opacity,
						label: level.label,
						// A range scale's lower bound, for screen readers; categories have none.
						tick:
							scale.kind === "range" && level.min !== null
								? format.number(Math.floor(level.min))
								: ""
					}))
				};
	return { pluginId: data.pluginId, title: data.title, units: data.units, bar };
}

/**
 * How a translucent fill looks over the page background (`background` is the computed
 * `--background`, in a form color2k parses). An empty color or no opacity returns the color.
 */
export function swatchOverBackground(
	color: string,
	opacity: number | null,
	background: string
): string {
	if (!color || opacity === null) return color;
	return mix(background, color, opacity);
}
