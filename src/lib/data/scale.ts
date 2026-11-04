import type { Level, Scale } from "./scale-types.js";

/** Returned by `levelFor` when no level covers the value. */
export const NO_LEVEL: unique symbol = Symbol("no-level");

export interface LegacyLevel {
	name: string;
	label: string;
	color: string;
	range: readonly [number, number, ...unknown[]];
	guidance: string | null;
}

/**
 * A reading as a number: a finite number, or a non-blank string that reads as one; else null.
 * The one rule for what counts as a reading (levels, averages, tooltips).
 */
export function numericValue(value: number | string | null | undefined): number | null {
	if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * Find the level a value falls in. Range levels are half-open, [min, max), and a null max
 * is unbounded. Numeric strings are coerced for range scales only.
 */
export function levelFor(
	value: number | string | null | undefined,
	scale: Scale
): Level | typeof NO_LEVEL {
	if (value === null || value === undefined) return NO_LEVEL;

	if (scale.kind === "category") {
		return scale.levels.find((level) => level.value === value) ?? NO_LEVEL;
	}

	const n = numericValue(value);
	if (n === null) return NO_LEVEL;

	return (
		scale.levels.find(
			(level) => level.min !== null && n >= level.min && (level.max == null || n < level.max)
		) ?? NO_LEVEL
	);
}

/** Convert the old monitors-meta `levels` shape into a half-open range scale. */
export function scaleFromLegacyLevels(
	id: string,
	label: string,
	units: string,
	levels: LegacyLevel[]
): Scale {
	return {
		id,
		label,
		units,
		kind: "range",
		source: null,
		levels: levels.map((level, i) => ({
			key: level.name.toLowerCase(),
			label: level.label,
			color: level.color,
			opacity: null,
			tier: null,
			description: "",
			guidance: level.guidance ?? "",
			min: level.range[0],
			max: levels[i + 1]?.range[0] ?? null,
			value: null
		}))
	};
}
