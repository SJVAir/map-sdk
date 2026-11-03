const PACIFIC = "America/Los_Angeles";

export interface FormatProvider {
	number(value: number, options?: Intl.NumberFormatOptions): string;
	/** Formats in Pacific time. */
	dateTime(value: Date | string): string;
	/** "PT" only when the device zone isn't Pacific. */
	zoneLabel(): string | null;
}

export function createDefaultFormat(
	deviceZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): FormatProvider {
	const dateFormat = new Intl.DateTimeFormat("en-US", {
		timeZone: PACIFIC,
		dateStyle: "medium",
		timeStyle: "short"
	});
	return {
		number: (value, options) => new Intl.NumberFormat("en-US", options).format(value),
		dateTime: (value) => dateFormat.format(typeof value === "string" ? new Date(value) : value),
		zoneLabel: () => (deviceZone === PACIFIC ? null : "PT")
	};
}
