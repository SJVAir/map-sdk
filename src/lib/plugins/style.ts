import type { ExpressionSpecification } from "@maptiler/sdk";
import type { Level, Scale } from "../data/scale-types.js";

/** Theme token read at plugin setup (getComputedStyle on the container) for unmatched values. */
export const NEUTRAL_COLOR_VAR = "--muted";

/** Concrete colors for map paint and marker images, read from the host's theme tokens. */
export interface ThemeColors {
	/** Values no level covers, and levels with an empty color: `--muted`. */
	neutral: string;
	/** The selection ring: `--highlight`, else `--primary`. */
	highlight: string;
	/** The check mark on the highlight: `--highlight-foreground`, else `--primary-foreground`. */
	highlightForeground: string;
	/** Marker and cluster outlines and cluster counts: `--foreground`. */
	foreground: string;
}

/**
 * The last resort when the host defines none of a color's tokens (or no DOM, as in unit tests).
 * Presentation only, never data, and the only hardcoded colors in the plugins.
 */
export const FALLBACK_THEME_COLORS: Readonly<ThemeColors> = {
	neutral: "#9ca3af",
	highlight: "#2563eb",
	highlightForeground: "#ffffff",
	foreground: "#111827"
};

const THEME_TOKENS: Record<keyof ThemeColors, string[]> = {
	neutral: [NEUTRAL_COLOR_VAR],
	highlight: ["--highlight", "--primary"],
	highlightForeground: ["--highlight-foreground", "--primary-foreground"],
	foreground: ["--foreground"]
};

/**
 * Resolves the theme tokens on `container` (the `[data-mapsdk-map]` element) to colors MapLibre
 * and marker images can use. Token values may be any CSS color (shadcn uses `oklch()`, which
 * MapLibre can't parse), so each is drawn to a 1×1 canvas and read back as `rgba()`.
 */
export function themeColors(container: Element | null): ThemeColors {
	const style =
		container && typeof getComputedStyle === "function" ? getComputedStyle(container) : null;
	const read = (names: string[], fallback: string): string => {
		for (const name of names) {
			const raw = style?.getPropertyValue(name).trim() ?? "";
			if (raw && CSS.supports("color", raw)) return toRgba(raw);
		}
		return fallback;
	};
	const out = { ...FALLBACK_THEME_COLORS };
	for (const key of Object.keys(THEME_TOKENS) as (keyof ThemeColors)[]) {
		out[key] = read(THEME_TOKENS[key], FALLBACK_THEME_COLORS[key]);
	}
	return out;
}

function toRgba(color: string): string {
	const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!ctx) return color;
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
}

type Output = string | number;

/** Breakpoint input for null and non-numeric values: below every real level. */
const MISSING = -1;

/**
 * The value as a number for a range lookup, like `levelFor`: a number, or a non-blank numeric
 * string; anything else (null, missing, blank or non-numeric strings, booleans, arrays) is
 * MISSING. `to-number` alone would read null, "", " " and false as 0 (the first level) and
 * true as 1. There is no trim in expressions, so a string converting to 0 counts as blank unless
 * it contains a "0" (every non-blank string Number() reads as 0 does).
 */
function numeric(property: string): ExpressionSpecification {
	const v = ["var", "v"];
	const n = ["var", "n"];
	return [
		"let",
		"v",
		["get", property],
		[
			"case",
			["==", ["typeof", v], "number"],
			["to-number", v],
			["==", ["typeof", v], "string"],
			[
				"let",
				"n",
				["to-number", v, MISSING],
				["case", ["all", ["==", n, 0], ["!", ["in", "0", ["to-string", v]]]], MISSING, n]
			],
			MISSING
		]
	] as unknown as ExpressionSpecification;
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
