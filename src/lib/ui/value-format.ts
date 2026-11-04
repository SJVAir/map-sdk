import type { FormatProvider } from "../data/format.js";

/**
 * A numeric value with exactly `precision` decimal places, or as `format.number` gives it when
 * there is no precision. Every place that shows a value (list rows, tooltips) goes through this,
 * so they all agree.
 */
export function formatValue(
	value: number,
	precision: number | undefined,
	format: FormatProvider
): string {
	if (precision === undefined) return format.number(value);
	return format.number(value, {
		minimumFractionDigits: precision,
		maximumFractionDigits: precision
	});
}
