const PACIFIC = "America/Los_Angeles";

export interface FormatProvider {
	number(value: number, options?: Intl.NumberFormatOptions): string;
	/** Formats in Pacific time. */
	dateTime(value: Date | string): string;
	/** "PT" only when the device zone isn't Pacific. */
	zoneLabel(): string | null;
	/** How long ago (or until) `value` is from `now` (default: the current time), e.g. "5 minutes ago". */
	relativeTime(value: Date | string, now?: Date): string;
}

export function createDefaultFormat(
	deviceZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): FormatProvider {
	const dateFormat = new Intl.DateTimeFormat("en-US", {
		timeZone: PACIFIC,
		dateStyle: "medium",
		timeStyle: "short"
	});
	const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "always" });
	return {
		number: (value, options) => new Intl.NumberFormat("en-US", options).format(value),
		dateTime: (value) => dateFormat.format(typeof value === "string" ? new Date(value) : value),
		zoneLabel: () => (deviceZone === PACIFIC ? null : "PT"),
		relativeTime: (value, now = new Date()) => {
			const ms = (typeof value === "string" ? new Date(value) : value).getTime() - now.getTime();
			const minutes = Math.round(ms / 60_000);
			if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
			const hours = Math.round(ms / 3_600_000);
			if (Math.abs(hours) < 24) return relative.format(hours, "hour");
			return relative.format(Math.round(ms / 86_400_000), "day");
		}
	};
}
