import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";
import { createMap } from "../../../src/lib/core/create-map.svelte.js";
import type { MetadataProvider, MonitorGroup } from "../../../src/lib/data/metadata.js";
import {
	monitorsOptions,
	type MonitorsOptionsInput
} from "../../../src/lib/options/monitors-options.svelte.js";
import type { OptionGroup, OptionRow } from "../../../src/lib/options/types.js";
import { rootEffect } from "../../fixtures/effects.svelte.js";

const GROUPS: MonitorGroup[] = [
	{ key: "reference", label: "Reference-grade", order: 0 },
	{ key: "low-cost", label: "Low-cost sensors", order: 1 }
];
const TYPES: Record<string, { label: string; group: string | null; reports: string[] }> = {
	airnow: { label: "AirNow", group: "reference", reports: ["pm25", "o3"] },
	aqview: { label: "AQview", group: "reference", reports: ["pm25"] },
	purpleair: { label: "PurpleAir", group: "low-cost", reports: ["pm25"] },
	airgradient: { label: "AirGradient", group: "low-cost", reports: ["pm25"] },
	cimis: { label: "CIMIS", group: null, reports: ["pm25"] }
};
const ENTRIES: Record<string, { label: string; units: string; help: string | null }> = {
	pm25: { label: "PM2.5", units: "µg/m³", help: "Fine particles." },
	o3: { label: "Ozone", units: "ppb", help: null }
};

function provider(extra: Partial<MetadataProvider> = {}): MetadataProvider {
	const ok = <T>(v: T | undefined) => Promise.resolve(v === undefined ? "unavailable" : v);
	return {
		scale: () => Promise.resolve("unavailable"),
		attribution: () => Promise.resolve("unavailable"),
		entryType: (ref) =>
			ok(ENTRIES[ref.entryType] && { ...ENTRIES[ref.entryType], precision: null }),
		monitorTypeLabel: (type) => ok(TYPES[type]?.label),
		monitorGroups: () => ok(GROUPS),
		monitorTypeGroup: (type) => ok(TYPES[type]?.group ?? undefined),
		monitorTypeReports: (type, entry) =>
			ok(TYPES[type] ? TYPES[type].reports.includes(entry) : undefined),
		entryTypeHelp: (ref) => ok(ENTRIES[ref.entryType]?.help ?? undefined),
		...extra
	} as MetadataProvider;
}

/** Builds the preset in an effect (as a host's $derived would), waits for the labels, returns the last result. */
async function build(input: MonitorsOptionsInput, metadata = provider()) {
	const map = createMap({ config: { maptilerKey: "k" }, metadata });
	const options = monitorsOptions(map);
	let last: ReturnType<typeof options.groups> | undefined;
	let runs = 0;
	const stop = rootEffect(() => {
		last = options.groups(input);
		runs++;
	});
	for (let i = 0; i < 5; i++) {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
	}
	stop();
	return { result: last!, runs };
}

const group = (groups: OptionGroup[], id: string) => groups.find((g) => g.id === id);
const labels = (rows: OptionRow[]) =>
	rows.map((r) =>
		r.kind === "group"
			? `[${r.label}: ${r.children.map((c) => c.label).join(", ")}]`
			: r.kind === "separator"
				? "—"
				: "label" in r
					? r.label
					: r.kind
	);
const svg = (row: OptionRow) =>
	"icon" in row && row.icon && "svg" in row.icon ? row.icon.svg : "";

describe("monitorsOptions", () => {
	it("types spanning both groups: monitor-map's headings, in group order, types in input order", async () => {
		const { result } = await build({
			types: ["purpleair", "airnow", "airgradient", "aqview"],
			pollutants: ["pm25", "o3"],
			pollutant: "pm25"
		});
		const monitors = group(result.groups, "monitors")!;
		expect(monitors.label).toBe("Monitors");
		expect(labels(monitors.rows)).toEqual([
			"[Reference-grade: AirNow, AQview]",
			"[Low-cost sensors: PurpleAir, AirGradient]"
		]);
		expect(svg(monitors.rows[0])).toContain("<polygon");
		expect(svg(monitors.rows[1])).toContain("<circle");
		expect(result.defaults).toMatchObject({
			"type:purpleair": true,
			"type:airnow": true,
			"type:airgradient": true,
			"type:aqview": true
		});
	});

	it("types in one group: a flat list, each with its group's marker", async () => {
		const { result } = await build({
			types: ["airnow", "aqview"],
			pollutants: ["pm25"],
			pollutant: "pm25"
		});
		const rows = group(result.groups, "monitors")!.rows;
		expect(labels(rows)).toEqual(["AirNow", "AQview"]);
		expect(rows.every((r) => svg(r).includes("<polygon"))).toBe(true);
	});

	it("a type with no group goes last, under no heading, in a grouped list", async () => {
		const { result } = await build({
			types: ["cimis", "airnow", "purpleair"],
			pollutants: ["pm25"],
			pollutant: "pm25"
		});
		expect(labels(group(result.groups, "monitors")!.rows)).toEqual([
			"[Reference-grade: AirNow]",
			"[Low-cost sensors: PurpleAir]",
			"CIMIS"
		]);
	});

	it("leaves out a type that doesn't report the pollutant; keeps one the metadata can't answer for", async () => {
		const { result } = await build(
			{ types: ["airnow", "purpleair", "mystery"], pollutants: ["pm25", "o3"], pollutant: "o3" },
			provider()
		);
		expect(labels(group(result.groups, "monitors")!.rows)).toEqual(["AirNow", "mystery"]);
	});

	it("without group metadata (an older server): a flat list, no throw", async () => {
		const { result } = await build(
			{ types: ["airnow", "purpleair"], pollutants: ["pm25"], pollutant: "pm25" },
			provider({ monitorGroups: undefined, monitorTypeGroup: undefined })
		);
		expect(labels(group(result.groups, "monitors")!.rows)).toEqual(["AirNow", "PurpleAir"]);
	});

	it("Pollutant: radios with label, unit and help; the trigger follows the choice", async () => {
		const pm = { svg: "<svg id='pm'></svg>" };
		const { result } = await build({
			types: ["airnow"],
			pollutants: ["pm25", "o3"],
			pollutant: "o3",
			defaultPollutant: "pm25",
			icons: { pollutant: { pm25: pm } }
		});
		const pollutant = group(result.groups, "pollutant")!;
		expect(pollutant.label).toBe("Ozone");
		const radio = pollutant.rows[0] as Extract<OptionRow, { kind: "radio" }>;
		expect(radio).toMatchObject({ kind: "radio", id: "pollutant", closesMenu: true });
		expect(radio.choices).toEqual([
			{ value: "pm25", label: "PM2.5", unit: "µg/m³", help: "Fine particles.", icon: pm },
			{ value: "o3", label: "Ozone", unit: "ppb" }
		]);
		expect(result.defaults.pollutant).toBe("pm25");
	});

	it("one pollutant and no None: no Pollutant group", async () => {
		const { result } = await build({ types: ["airnow"], pollutants: ["pm25"], pollutant: "pm25" });
		expect(group(result.groups, "pollutant")).toBeUndefined();
	});

	it("None: an extra choice, and the Monitors group disabled while it's chosen", async () => {
		const { result } = await build({
			types: ["airnow"],
			pollutants: ["pm25"],
			pollutant: null,
			none: true
		});
		const radio = group(result.groups, "pollutant")!.rows[0] as Extract<
			OptionRow,
			{ kind: "radio" }
		>;
		expect(radio.choices.map((c) => [c.value, c.label])).toEqual([
			["pm25", "PM2.5"],
			["none", "None"]
		]);
		expect(group(result.groups, "pollutant")!.label).toBe("None");
		expect(group(result.groups, "monitors")!.disabled).toBe(true);
	});

	it("Inactive and Inside only when present; Collocation Sites only for PM2.5", async () => {
		const base = { types: ["airnow"], pollutants: ["pm25", "o3"] };
		let { result } = await build({ ...base, pollutant: "pm25" });
		expect(labels(group(result.groups, "monitors")!.rows)).toEqual(["AirNow"]);
		({ result } = await build({
			...base,
			pollutant: "pm25",
			hasInactive: true,
			hasInside: true,
			collocation: true
		}));
		expect(labels(group(result.groups, "monitors")!.rows)).toEqual([
			"AirNow",
			"—",
			"Inactive",
			"Inside",
			"Collocation Sites"
		]);
		expect(result.defaults).toMatchObject({
			inactive: false,
			inside: false,
			collocationSites: false
		});
		({ result } = await build({ ...base, pollutant: "o3", collocation: true }));
		expect(labels(group(result.groups, "monitors")!.rows)).toEqual(["AirNow"]);
	});

	it("labels arrive after the first build, and a $derived over it re-runs", async () => {
		const { result, runs } = await build({
			types: ["airnow"],
			pollutants: ["pm25", "o3"],
			pollutant: "pm25"
		});
		expect(runs).toBeGreaterThan(1);
		expect(labels(group(result.groups, "monitors")!.rows)).toEqual(["AirNow"]);
	});
});
