import { mix } from "color2k";
import type { Snippet } from "svelte";
import type { LegendData } from "../core/plugin.js";
import type { FormatProvider } from "../data/format.js";
import type { ScaleRef } from "../data/scale-types.js";
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
	/** The plugin's scale reference; sections with equal references are shown as one. */
	scaleRef?: ScaleRef;
	/** The entry type's label: a shared section's title. */
	scaleLabel?: string;
	/** The scale's own label: a shared section's title until a `scaleLabel` is known. */
	scaleName?: string;
	/** Ends with a "No data" row: a member draws features with no figure as outlines. */
	noFigure: boolean;
	/** The no-figure row's text in place of "No data". */
	noFigureLabel?: string;
	/** A unit line under the title, in place of `units` after it. */
	unitsLine?: string;
	/** Host content at the section's foot, below "No data". */
	note?: Snippet;
}

export type LegendEntry =
	| { kind: "scale"; section: LegendSection }
	| {
			kind: "symbols";
			pluginId: string;
			title: string;
			symbols: Array<{ label: string; markup: string }>;
	  }
	| { kind: "status"; pluginId: string; layer: string; status: DataStatus; note?: Snippet };

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
	return {
		pluginId: data.pluginId,
		title: data.title,
		units: data.units,
		bar,
		...(data.scaleRef && { scaleRef: data.scaleRef }),
		...(data.scaleLabel && { scaleLabel: data.scaleLabel }),
		...(scale.label && { scaleName: scale.label }),
		noFigure: data.noFigure === true,
		...(data.noFigureLabel && { noFigureLabel: data.noFigureLabel }),
		...(data.unitsLine && { unitsLine: data.unitsLine }),
		...(data.note && { note: data.note })
	};
}

const sameRef = (a: ScaleRef, b: ScaleRef) =>
	a.dataset === b.dataset && a.entryType === b.entryType;

/**
 * One section per shared scale reference, at its first member's place; the others close up. A
 * shared section is titled with the first member's `scaleLabel` that is set (else the scale's
 * own label, else the first title), and has the "No data" row when any member does, labeled with
 * the first member's `noFigureLabel` that is set. A section that shares with none, and status
 * and symbol entries, are kept as they are.
 */
export function shareSections(entries: LegendEntry[]): LegendEntry[] {
	const groups: LegendSection[][] = [];
	const out: Array<LegendEntry | LegendSection[]> = [];
	for (const entry of entries) {
		const ref = entry.kind === "scale" ? entry.section.scaleRef : undefined;
		const group = ref && groups.find((g) => sameRef(g[0].scaleRef!, ref));
		if (entry.kind !== "scale" || !ref) out.push(entry);
		else if (group) group.push(entry.section);
		else {
			const created = [entry.section];
			groups.push(created);
			out.push(created);
		}
	}
	return out.map((item): LegendEntry => {
		if (!Array.isArray(item)) return item;
		const [first] = item;
		if (item.length === 1) return { kind: "scale", section: first };
		// The scale's own label stands in until the metadata's arrives, so the title doesn't flip.
		const title = item.find((s) => s.scaleLabel)?.scaleLabel ?? (first.scaleName || first.title);
		const noFigure = item.some((s) => s.noFigure);
		const noFigureLabel = item.find((s) => s.noFigureLabel)?.noFigureLabel;
		const unitsLine = item.find((s) => s.unitsLine)?.unitsLine;
		const note = item.find((s) => s.note)?.note;
		return {
			kind: "scale",
			section: {
				...first,
				title,
				noFigure,
				...(noFigureLabel && { noFigureLabel }),
				...(unitsLine && { unitsLine }),
				...(note && { note })
			}
		};
	});
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
