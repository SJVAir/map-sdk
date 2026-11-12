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
	/** Markers drawn muted by default (see `icon.mutedColor`): `--muted-foreground`. */
	mutedForeground: string;
	/**
	 * The focus area's line, point ring, and label: `--focus-area`, else a fixed slate. Fixed, not
	 * the theme's: the basemap under it doesn't follow the theme.
	 */
	focusArea: string;
	/** The casing under the line and ring, and the label's halo: `--focus-area-casing`, else white. */
	focusAreaCasing: string;
	/** The wash outside a focus area: `--focus-area-wash`, else white. */
	focusAreaWash: string;
}

/**
 * The last resort when the host defines none of a color's tokens (or no DOM, as in unit tests).
 * Presentation only, never data, and the only hardcoded colors in the plugins.
 */
export const FALLBACK_THEME_COLORS: Readonly<ThemeColors> = {
	neutral: "#9ca3af",
	highlight: "#2563eb",
	highlightForeground: "#ffffff",
	foreground: "#111827",
	mutedForeground: "#6b7280",
	// The user's decision (2026-11-11), an exception to the theme-token rule: the focus area's
	// colors are fixed (sjvair.com's explorers' white casing and wash, their county-line slate),
	// since they sit on a basemap that doesn't follow the theme. Hosts override them with the
	// `--focus-area*` tokens.
	focusArea: "#1f2d3d",
	focusAreaCasing: "#ffffff",
	focusAreaWash: "#ffffff"
};

const THEME_TOKENS: Record<keyof ThemeColors, string[]> = {
	neutral: [NEUTRAL_COLOR_VAR],
	highlight: ["--highlight", "--primary"],
	highlightForeground: ["--highlight-foreground", "--primary-foreground"],
	foreground: ["--foreground"],
	mutedForeground: ["--muted-foreground"],
	focusArea: ["--focus-area"],
	focusAreaCasing: ["--focus-area-casing"],
	focusAreaWash: ["--focus-area-wash"]
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
			if (raw && CSS.supports("color", raw)) return toRgba(raw, fallback);
		}
		return fallback;
	};
	const out = { ...FALLBACK_THEME_COLORS };
	for (const key of Object.keys(THEME_TOKENS) as (keyof ThemeColors)[]) {
		out[key] = read(THEME_TOKENS[key], FALLBACK_THEME_COLORS[key]);
	}
	return out;
}

/**
 * The raw values of every token `themeColors` reads, as one string: when it changes, the colors
 * plugins baked into paint and images are stale.
 */
export function themeSignature(container: Element): string {
	const style = getComputedStyle(container);
	return Object.values(THEME_TOKENS)
		.flat()
		.map((name) => style.getPropertyValue(name).trim())
		.join("|");
}

/** A color canvas leaves `fillStyle` at when it rejects a value. */
const SENTINEL = "#010203";

function toRgba(color: string, fallback: string): string {
	const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!ctx) return color;
	ctx.fillStyle = SENTINEL;
	ctx.fillStyle = color;
	// Unchanged: canvas couldn't parse it (an assignment it rejects is ignored), so not black.
	if (ctx.fillStyle === SENTINEL && color.toLowerCase() !== SENTINEL) return fallback;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
	return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
}

type Output = string | number;

/**
 * What a lookup reads: the feature's `value` property, or an expression computing a value (e.g. a
 * cluster's average). An expression that may have no value must be numeric and give
 * `MISSING_VALUE` then (MapLibre won't mix null into a number expression).
 */
export type ValueInput = "value" | ExpressionSpecification;

/** Breakpoint input for null and non-numeric values: below every real level. */
export const MISSING_VALUE = -1;
const MISSING = MISSING_VALUE;

function read(input: ValueInput): ExpressionSpecification {
	return typeof input === "string" ? ["get", input] : input;
}

/**
 * The value as a number for a range lookup, like `levelFor`: a number, or a non-blank numeric
 * string; anything else (null, missing, blank or non-numeric strings, booleans, arrays) is
 * MISSING. `to-number` alone would read null, "", " " and false as 0 (the first level) and
 * true as 1. There is no trim in expressions, so a string converting to 0 counts as blank unless
 * it contains a "0" (every non-blank string Number() reads as 0 does).
 *
 * Accepted gap: "Infinity" and "1e999" convert to Infinity and step to the top level, while
 * `levelFor` says NO_LEVEL (expressions have no clean finiteness check).
 */
function numeric(input: ValueInput): ExpressionSpecification {
	const v = ["var", "v"];
	const n = ["var", "n"];
	return [
		"let",
		"v",
		read(input),
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
 * True where the input is a reading by `numericValue`'s rule: a number, or a non-blank numeric
 * string (same blank-string test as `numeric`; "Infinity" is the same accepted gap). A string
 * that two different `to-number` fallbacks both pass through converted.
 */
export function hasNumericValue(input: ValueInput): ExpressionSpecification {
	const v = ["var", "v"];
	const a = ["var", "a"];
	return [
		"let",
		"v",
		read(input),
		[
			"case",
			["==", ["typeof", v], "number"],
			true,
			["==", ["typeof", v], "string"],
			[
				"let",
				"a",
				["to-number", v, -1],
				[
					"all",
					["==", a, ["to-number", v, -2]],
					["!", ["all", ["==", a, 0], ["!", ["in", "0", v]]]]
				]
			],
			false
		]
	] as unknown as ExpressionSpecification;
}

/**
 * Half-open range lookup matching `levelFor`: a level covers [min, max), the value `max` goes
 * to the next level, and a gap or an unbounded-below input falls to `fallback`.
 */
function rangeStep(
	scale: Scale,
	input: ValueInput,
	fallback: Output,
	pick: (level: Level) => Output | null
): ExpressionSpecification {
	const stops: Output[] = [];
	let last: number | null = null;
	const levels = scale.levels
		.filter((l) => l.min !== null)
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
	return ["step", numeric(input), fallback, ...stops] as unknown as ExpressionSpecification;
}

function categoryMatch(
	scale: Scale,
	input: ValueInput,
	fallback: Output,
	pick: (level: Level) => Output | null
): ExpressionSpecification {
	const arms: Output[] = [];
	for (const level of scale.levels) {
		if (level.value === null) continue;
		arms.push(level.value, pick(level) ?? fallback);
	}
	if (arms.length === 0) return ["literal", fallback] as unknown as ExpressionSpecification;
	return ["match", read(input), ...arms, fallback] as unknown as ExpressionSpecification;
}

/** Per-level output for the level `input` falls in; `fallback` where no level applies. */
export function levelLookup(
	scale: Scale,
	input: ValueInput,
	fallback: Output,
	pick: (level: Level) => Output | null
): ExpressionSpecification {
	return scale.kind === "range"
		? rangeStep(scale, input, fallback, pick)
		: categoryMatch(scale, input, fallback, pick);
}

/** Fill color per level; unmatched values and levels with an empty color use `neutral`. */
export function colorExpression(
	scale: Scale,
	property: "value",
	neutral: string
): ExpressionSpecification {
	return levelLookup(scale, property, neutral, (level) => level.color || null);
}

/** Opacity per level, or the plain `fallback` number when no level sets one. */
export function opacityExpression(
	scale: Scale,
	property: "value",
	fallback: number
): ExpressionSpecification | number {
	if (!scale.levels.some((level) => level.opacity !== null)) return fallback;
	return levelLookup(scale, property, fallback, (level) => level.opacity);
}

/** Level key per value ("" where no level applies), for filters and icon ids. */
export function levelKeyExpression(scale: Scale, input: ValueInput): ExpressionSpecification {
	return levelLookup(scale, input, "", (level) => level.key);
}
