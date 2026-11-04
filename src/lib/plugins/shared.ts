import type { ExpressionSpecification } from "@maptiler/sdk";
import type { FeatureHit } from "../core/plugin.js";
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
