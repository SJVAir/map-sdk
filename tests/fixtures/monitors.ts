import type { MonitorFeatureProperties } from "../../src/lib/data/types.js";

/** One monitor's properties, active and outside unless overridden. */
export function monitor(
	id: string,
	type: string,
	value: MonitorFeatureProperties["value"],
	extra: Partial<MonitorFeatureProperties> = {}
): MonitorFeatureProperties {
	return {
		refKey: `monitor:${id}`,
		name: `Monitor ${id}`,
		value,
		type,
		isActive: true,
		isSjvair: false,
		location: "outside",
		timestamp: "2026-11-03T21:00:00Z",
		...extra
	};
}

/** Monitors of three types, one inactive and one inside. */
export const MONITORS: MonitorFeatureProperties[] = [
	monitor("1", "purpleair", 4, { isSjvair: true }),
	monitor("2", "purpleair", 40),
	monitor("3", "airnow", 12),
	monitor("4", "airgradient", 60, { isActive: false }),
	monitor("5", "purpleair", 20, { location: "inside" })
];
