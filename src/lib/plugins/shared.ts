import type { ExpressionSpecification } from "@maptiler/sdk";
import type { Snippet } from "svelte";
import type { FeatureHit, LegendData } from "../core/plugin.js";
import { decodeRef } from "../data/refs.js";

/** 1 where the feature's `selected` state is set, else 0. */
export const SELECTED_OPACITY: ExpressionSpecification = [
	"case",
	["boolean", ["feature-state", "selected"], false],
	1,
	0
];

/** The hit for a rendered feature's properties (`refKey`, `name`), or null without a valid ref. */
export function hitFromProps(pluginId: string, props: Record<string, unknown>): FeatureHit | null {
	const refKey = props.refKey;
	if (typeof refKey !== "string") return null;
	const ref = decodeRef(refKey);
	if (!ref) return null;
	return { pluginId, ref, refKey, name: typeof props.name === "string" ? props.name : "" };
}

/** Adds a host's legend unit line and note to scale legend data; other data passes through. */
export function hostLegend(
	unitsLine: string | undefined,
	note: Snippet | undefined
): (data: LegendData | null) => LegendData | null {
	if (!unitsLine && !note) return (data) => data;
	return (data) =>
		data && "scale" in data
			? { ...data, ...(unitsLine && { unitsLine }), ...(note && { note }) }
			: data;
}
