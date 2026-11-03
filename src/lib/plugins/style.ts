import type { ExpressionSpecification } from "@maptiler/sdk";
import type { Level, Scale } from "../data/scale-types.js";

/** Theme token read at plugin setup (getComputedStyle on the container) for unmatched values. */
export const NEUTRAL_COLOR_VAR = "--muted";

type Output = string | number;

/** Breakpoint input for null and non-numeric values: below every real level. */
const MISSING = -1;

// `to-number` turns null into 0, which would read as the first level; coalesce swaps null
// (and a missing property) for a string that (non-numeric) fails the conversion and lands on MISSING.
function numeric(property: string): ExpressionSpecification {
	return ["to-number", ["coalesce", ["get", property], "none"], MISSING];
}

/**
 * Half-open range lookup matching `levelFor`: a level covers [min, max), the value `max` goes
 * to the next level, and a gap or an unbounded-below input falls to `fallback`.
 */
function rangeStep(
	scale: Scale,
	property: string,
	fallback: Output,
	pick: (level: Level) => Output | null
): ExpressionSpecification {
	const stops: Output[] = [];
	let last: number | null = null;
	const levels = scale.levels
		.filter((l) => l.min !== undefined)
		.sort((a, b) => (a.min as number) - (b.min as number));
	for (const level of levels) {
		const min = level.min as number;
		// Close a gap left by the previous level's max.
		if (last !== null && last < min) stops.push(last, fallback);
		stops.push(min, pick(level) ?? fallback);
		last = level.max ?? null;
		if (last === null) break;
	}
	if (last !== null) stops.push(last, fallback);
	if (stops.length === 0) return ["literal", fallback] as unknown as ExpressionSpecification;
	return ["step", numeric(property), fallback, ...stops] as unknown as ExpressionSpecification;
}

function categoryMatch(
	scale: Scale,
	property: string,
	fallback: Output,
	pick: (level: Level) => Output | null
): ExpressionSpecification {
	const arms: Output[] = [];
	for (const level of scale.levels) {
		if (level.value === undefined) continue;
		arms.push(level.value, pick(level) ?? fallback);
	}
	if (arms.length === 0) return ["literal", fallback] as unknown as ExpressionSpecification;
	return ["match", ["get", property], ...arms, fallback] as unknown as ExpressionSpecification;
}

function lookup(
	scale: Scale,
	property: string,
	fallback: Output,
	pick: (level: Level) => Output | null
): ExpressionSpecification {
	return scale.kind === "range"
		? rangeStep(scale, property, fallback, pick)
		: categoryMatch(scale, property, fallback, pick);
}

/** Fill color per level; unmatched values and levels with an empty color use `neutral`. */
export function colorExpression(
	scale: Scale,
	property: "value",
	neutral: string
): ExpressionSpecification {
	return lookup(scale, property, neutral, (level) => level.color || null);
}

/** Opacity per level, or the plain `fallback` number when no level sets one. */
export function opacityExpression(
	scale: Scale,
	property: "value",
	fallback: number
): ExpressionSpecification | number {
	if (!scale.levels.some((level) => level.opacity !== null)) return fallback;
	return lookup(scale, property, fallback, (level) => level.opacity);
}

/** Level key per value ("" where no level applies), for filters and icon ids. */
export function levelKeyExpression(scale: Scale, property: "value"): ExpressionSpecification {
	return lookup(scale, property, "", (level) => level.key);
}
