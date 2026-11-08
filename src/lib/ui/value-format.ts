import type { FormatProvider } from "../data/format.js";

/**
 * A numeric value with exactly `precision` decimal places, or as `format.number` gives it when
 * there is no precision. Every place that shows a value (list rows, tooltips) goes through this,
 * so they all agree. With `truncate` the extra decimals are cut off rather than rounded (9.96 at
 * precision 1 is "9.9"), so the number never reads as the next level up.
 */
export function formatValue(
	value: number,
	precision: number | undefined,
	format: FormatProvider,
	truncate = false
): string {
	if (precision === undefined) return format.number(value);
	if (truncate) {
		const factor = 10 ** precision;
		// toPrecision drops float noise first (4.35 * 100 is 434.99999999999994).
		value = Math.trunc(Number((value * factor).toPrecision(12))) / factor;
	}
	return format.number(value, {
		minimumFractionDigits: precision,
		maximumFractionDigits: precision
	});
}
