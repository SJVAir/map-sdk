import { beforeEach, describe, expect, it, vi } from "vitest";
import { burnScale, fireScale, heatScale, pm25Scale, smokeScale } from "../../fixtures/scales.js";

const getMonitorsMeta = vi.fn();
const getDatasetCatalog = vi.fn();
const getHMSMeta = vi.fn();
const getCalHeatScoreMeta = vi.fn();
const getForecastsMeta = vi.fn();
const getRegionsMeta = vi.fn();
vi.mock("@sjvair/sdk", () => ({
	getHMSMeta: (...args: unknown[]) => getHMSMeta(...args),
	getCalHeatScoreMeta: (...args: unknown[]) => getCalHeatScoreMeta(...args),
	getForecastsMeta: (...args: unknown[]) => getForecastsMeta(...args),
	getMonitorsMeta: (...args: unknown[]) => getMonitorsMeta(...args),
	getDatasetCatalog: (...args: unknown[]) => getDatasetCatalog(...args),
	getRegionsMeta: (...args: unknown[]) => getRegionsMeta(...args)
}));

const { createDefaultMetadata } = await import("../../../src/lib/data/metadata.js");

const pm25 = { dataset: "air-quality", entryType: "pm25" };

function monitorsMeta() {
	return {
		entries: {
			pm25: { label: "PM2.5", units: "µg/m³", scale: pm25Scale },
			o3: { label: "Ozone", units: "ppb" }
		},
		monitors: { airgradient: { label: "AirGradient", expected_interval: "1 min" } }
	};
}

beforeEach(() => {
	getMonitorsMeta.mockReset();
	getDatasetCatalog.mockReset();
	getHMSMeta.mockReset();
	getCalHeatScoreMeta.mockReset();
	getForecastsMeta.mockReset();
	getRegionsMeta.mockReset();
});

describe("default metadata", () => {
	it("shares one fetch between concurrent callers", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		const meta = createDefaultMetadata();
		const [a, b] = await Promise.all([meta.scale(pm25), meta.scale(pm25)]);
		expect(getMonitorsMeta).toHaveBeenCalledTimes(1);
		expect(a).toEqual(b);
	});

	it("uses a scale on the meta unchanged", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		expect(await createDefaultMetadata().scale(pm25)).toBe(pm25Scale);
	});

	it("monitors meta without scale is unavailable", async () => {
		const meta = monitorsMeta();
		delete (meta.entries.pm25 as { scale?: unknown }).scale;
		(meta.entries.pm25 as Record<string, unknown>).levels = { GOOD: { range: [0, 9] } };
		getMonitorsMeta.mockResolvedValue(meta);
		expect(await createDefaultMetadata().scale(pm25)).toBe("unavailable");
	});

	it("is unavailable for an unknown entry type, an entry without a scale, and other datasets", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		const meta = createDefaultMetadata();
		expect(await meta.scale({ dataset: "air-quality", entryType: "nope" })).toBe("unavailable");
		expect(await meta.scale({ dataset: "air-quality", entryType: "o3" })).toBe("unavailable");
		expect(await meta.scale({ dataset: "nope", entryType: "x" })).toBe("unavailable");
		expect(await meta.entryType({ dataset: "nope", entryType: "x" })).toBe("unavailable");
	});

	it.each([
		["hms-smoke", "smoke-density", smokeScale, getHMSMeta],
		["hms-fire", "fire-frp", fireScale, getHMSMeta],
		["calheatscore", "heat-score", heatScale, getCalHeatScoreMeta],
		["forecasts", "burn-status", burnScale, getForecastsMeta],
		["forecasts", "aqi-forecast", pm25Scale, getForecastsMeta]
	])("reads the %s dataset's %s scale from its meta", async (dataset, entryType, scale, mock) => {
		mock.mockResolvedValue({
			scales: {
				"smoke-density": smokeScale,
				"fire-frp": fireScale,
				"heat-score": heatScale,
				"burn-status": burnScale,
				"aqi-forecast": pm25Scale
			},
			zones: []
		});
		const meta = createDefaultMetadata();
		expect(await meta.scale({ dataset, entryType })).toBe(scale);
		expect(await meta.scale({ dataset, entryType: "nope" })).toBe("unavailable");
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it.each([
		["hms-fire", "fire-frp", fireScale, getHMSMeta],
		["calheatscore", "heat-score", heatScale, getCalHeatScoreMeta],
		["forecasts", "aqi-forecast", pm25Scale, getForecastsMeta]
	])("derives %s %s label and units from its scale", async (dataset, entryType, scale, mock) => {
		mock.mockResolvedValue({ scales: { [entryType]: scale }, zones: [] });
		const meta = createDefaultMetadata();
		expect(await meta.entryType({ dataset, entryType })).toEqual({
			label: scale.label,
			units: scale.units,
			precision: null
		});
		expect(await meta.entryType({ dataset, entryType: "nope" })).toBe("unavailable");
		await meta.scale({ dataset, entryType });
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it("serves hms-smoke and hms-fire from one HMS meta fetch", async () => {
		getHMSMeta.mockResolvedValue({
			scales: { "smoke-density": smokeScale, "fire-frp": fireScale }
		});
		const meta = createDefaultMetadata();
		expect(await meta.scale({ dataset: "hms-smoke", entryType: "smoke-density" })).toBe(smokeScale);
		expect(await meta.scale({ dataset: "hms-fire", entryType: "fire-frp" })).toBe(fireScale);
		expect(await meta.scale({ dataset: "hms", entryType: "fire-frp" })).toBe("unavailable");
		expect(getHMSMeta).toHaveBeenCalledTimes(1);
	});

	it("is unavailable when a dataset meta fails, and retries", async () => {
		getHMSMeta
			.mockRejectedValueOnce(new Error("down"))
			.mockResolvedValue({ scales: { "fire-frp": fireScale } });
		const meta = createDefaultMetadata();
		const ref = { dataset: "hms-fire", entryType: "fire-frp" };
		expect(await meta.scale(ref)).toBe("unavailable");
		expect(await meta.scale(ref)).toBe(fireScale);
	});

	it("gives label and units for an entry type", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		const meta = createDefaultMetadata();
		expect(await meta.entryType(pm25)).toEqual({ label: "PM2.5", units: "µg/m³", precision: null });
		expect(await meta.entryType({ dataset: "air-quality", entryType: "o3" })).toEqual({
			label: "Ozone",
			units: "ppb",
			precision: null
		});
	});

	it("gives the catalog's display precision", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		getHMSMeta.mockResolvedValue({ scales: { "fire-frp": fireScale } });
		const entry = (id: string, precision: number | null) => ({ id, display: { precision } });
		getDatasetCatalog.mockResolvedValue({
			datasets: [
				{ id: "air-quality", entry_types: [entry("pm25", 1), entry("o3", null)] },
				{ id: "hms-fire", entry_types: [entry("fire-frp", 2)] }
			]
		});
		const meta = createDefaultMetadata();
		expect(await meta.entryType(pm25)).toMatchObject({ precision: 1 });
		expect(await meta.entryType({ dataset: "air-quality", entryType: "o3" })).toMatchObject({
			precision: null
		});
		expect(await meta.entryType({ dataset: "hms-fire", entryType: "fire-frp" })).toMatchObject({
			precision: 2
		});
	});

	it("gives a null precision when the catalog fails", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		getDatasetCatalog.mockRejectedValue(new Error("404"));
		expect(await createDefaultMetadata().entryType(pm25)).toMatchObject({
			label: "PM2.5",
			precision: null
		});
	});

	it("reads monitor type labels", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		const meta = createDefaultMetadata();
		expect(await meta.monitorTypeLabel("airgradient")).toBe("AirGradient");
		expect(await meta.monitorTypeLabel("zzz")).toBe("unavailable");
	});

	it("monitorTypeInterval returns expected_interval", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		expect(await createDefaultMetadata().monitorTypeInterval!("airgradient")).toBe("1 min");
	});

	it("unknown type is unavailable for monitorTypeInterval", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		expect(await createDefaultMetadata().monitorTypeInterval!("zzz")).toBe("unavailable");
	});

	it("is unavailable after a failed fetch and fetches again next time", async () => {
		getMonitorsMeta.mockRejectedValueOnce(new Error("down")).mockResolvedValue(monitorsMeta());
		const meta = createDefaultMetadata();
		expect(await meta.scale(pm25)).toBe("unavailable");
		expect(await meta.scale(pm25)).not.toBe("unavailable");
		expect(getMonitorsMeta).toHaveBeenCalledTimes(2);
	});

	it("rejects an aborted caller while another still resolves, without passing a signal", async () => {
		let resolve!: (v: unknown) => void;
		getMonitorsMeta.mockReturnValue(new Promise((r) => (resolve = r)));
		const meta = createDefaultMetadata();
		const controller = new AbortController();
		const aborted = meta.scale(pm25, controller.signal);
		const other = meta.scale(pm25);
		controller.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		resolve(monitorsMeta());
		expect(await other).not.toBe("unavailable");
		expect(getMonitorsMeta).toHaveBeenCalledTimes(1);
		expect(getMonitorsMeta).toHaveBeenCalledWith();
	});

	it("reads attribution from the catalog source", async () => {
		getDatasetCatalog.mockResolvedValue({
			datasets: [
				{ id: "air-quality", source: "SJVAir" },
				{ id: "hms-fire", source: "NOAA HMS" },
				{ id: "hms-smoke", source: "" }
			]
		});
		const meta = createDefaultMetadata();
		expect(await meta.attribution("air-quality")).toBe("SJVAir");
		expect(await meta.attribution("hms-fire")).toBe("NOAA HMS");
		expect(await meta.attribution("hms-smoke")).toBe("unavailable");
		expect(await meta.attribution("other")).toBe("unavailable");
		expect(getDatasetCatalog).toHaveBeenCalledTimes(1);
	});

	it("is unavailable when the catalog fails", async () => {
		getDatasetCatalog.mockRejectedValue(new Error("404"));
		expect(await createDefaultMetadata().attribution("air-quality")).toBe("unavailable");
	});
});

describe("locationTypeLabel", () => {
	function regionsMeta() {
		return {
			location_types: {
				child_care: { type: "child_care", label: "Child care", source: "cdss" },
				public_school: { type: "public_school", label: "Public school", source: "cde" }
			}
		};
	}

	it("reads the label from the regions meta", async () => {
		getRegionsMeta.mockResolvedValue(regionsMeta());
		expect(await createDefaultMetadata().locationTypeLabel!("child_care")).toBe("Child care");
	});

	it("is unavailable for an unknown type", async () => {
		getRegionsMeta.mockResolvedValue(regionsMeta());
		expect(await createDefaultMetadata().locationTypeLabel!("charter")).toBe("unavailable");
	});

	it("is unavailable when the regions meta fails, and the next call retries", async () => {
		getRegionsMeta.mockRejectedValueOnce(new Error("down"));
		getRegionsMeta.mockResolvedValueOnce(regionsMeta());
		const meta = createDefaultMetadata();
		expect(await meta.locationTypeLabel!("child_care")).toBe("unavailable");
		expect(await meta.locationTypeLabel!("child_care")).toBe("Child care");
		expect(getRegionsMeta).toHaveBeenCalledTimes(2);
	});

	it("rejects only on the caller's abort", async () => {
		let resolve!: (value: unknown) => void;
		getRegionsMeta.mockReturnValue(new Promise((r) => (resolve = r)));
		const meta = createDefaultMetadata();
		const controller = new AbortController();
		const aborted = meta.locationTypeLabel!("child_care", controller.signal);
		const other = meta.locationTypeLabel!("child_care");
		controller.abort();
		await expect(aborted).rejects.toThrow();
		resolve(regionsMeta());
		expect(await other).toBe("Child care");
	});

	it("fetches the regions meta once for several types", async () => {
		getRegionsMeta.mockResolvedValue(regionsMeta());
		const meta = createDefaultMetadata();
		await Promise.all([
			meta.locationTypeLabel!("child_care"),
			meta.locationTypeLabel!("public_school")
		]);
		expect(getRegionsMeta).toHaveBeenCalledTimes(1);
	});
});

describe("default metadata: monitor groups, help text, published pairs", () => {
	function groupedMeta() {
		return {
			monitor_groups: {
				"low-cost": { key: "low-cost", label: "Low-cost sensors", order: 1 },
				reference: { key: "reference", label: "Reference-grade", order: 0 }
			},
			entries: {
				pm25: { label: "PM2.5", units: "µg/m³", description: "Fine particles." },
				o3: { label: "Ozone", units: "ppb", description: null }
			},
			monitors: {
				airnow: {
					label: "AirNow",
					group: "reference",
					entries: { pm25: { published: true }, o3: { published: true } }
				},
				purpleair: {
					label: "PurpleAir",
					group: "low-cost",
					entries: { pm25: { published: true } }
				},
				cimis: { label: "CIMIS", group: null, entries: { o3: { published: false } } },
				odd: { label: "Odd", group: "nope", entries: {} }
			}
		};
	}

	it("lists the groups sorted by order", async () => {
		getMonitorsMeta.mockResolvedValue(groupedMeta());
		expect(await createDefaultMetadata().monitorGroups!()).toEqual([
			{ key: "reference", label: "Reference-grade", order: 0 },
			{ key: "low-cost", label: "Low-cost sensors", order: 1 }
		]);
	});

	it("gives a type's group key, and unavailable for none or an unknown key", async () => {
		getMonitorsMeta.mockResolvedValue(groupedMeta());
		const meta = createDefaultMetadata();
		expect(await meta.monitorTypeGroup!("airnow")).toBe("reference");
		expect(await meta.monitorTypeGroup!("cimis")).toBe("unavailable");
		expect(await meta.monitorTypeGroup!("odd")).toBe("unavailable");
		expect(await meta.monitorTypeGroup!("zzz")).toBe("unavailable");
	});

	it("an older server with no groups: unavailable, never a throw", async () => {
		getMonitorsMeta.mockResolvedValue(monitorsMeta());
		const meta = createDefaultMetadata();
		expect(await meta.monitorGroups!()).toBe("unavailable");
		expect(await meta.monitorTypeGroup!("airgradient")).toBe("unavailable");
		expect(await meta.monitorTypeReports!("airgradient", "pm25")).toBe("unavailable");
	});

	it("gives an entry type's help text, unavailable when null", async () => {
		getMonitorsMeta.mockResolvedValue(groupedMeta());
		const meta = createDefaultMetadata();
		expect(await meta.entryTypeHelp!(pm25)).toBe("Fine particles.");
		expect(await meta.entryTypeHelp!({ dataset: "air-quality", entryType: "o3" })).toBe(
			"unavailable"
		);
	});

	it("says whether a type's entry is published on the map", async () => {
		getMonitorsMeta.mockResolvedValue(groupedMeta());
		const meta = createDefaultMetadata();
		expect(await meta.monitorTypeReports!("airnow", "o3")).toBe(true);
		expect(await meta.monitorTypeReports!("purpleair", "o3")).toBe(false);
		expect(await meta.monitorTypeReports!("cimis", "o3")).toBe(false);
	});

	it("only the caller's abort rejects", async () => {
		getMonitorsMeta.mockRejectedValue(new Error("down"));
		const meta = createDefaultMetadata();
		expect(await meta.monitorGroups!()).toBe("unavailable");
		const controller = new AbortController();
		controller.abort();
		await expect(meta.monitorTypeGroup!("airnow", controller.signal)).rejects.toThrow();
	});
});
