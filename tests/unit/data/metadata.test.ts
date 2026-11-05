import { beforeEach, describe, expect, it, vi } from "vitest";
import { burnScale, fireScale, heatScale, pm25Scale, smokeScale } from "../../fixtures/scales.js";

const getMonitorsMeta = vi.fn();
const getDatasetCatalog = vi.fn();
const getHMSMeta = vi.fn();
const getCalHeatScoreMeta = vi.fn();
const getForecastsMeta = vi.fn();
vi.mock("@sjvair/sdk", () => ({
	getHMSMeta: (...args: unknown[]) => getHMSMeta(...args),
	getCalHeatScoreMeta: (...args: unknown[]) => getCalHeatScoreMeta(...args),
	getForecastsMeta: (...args: unknown[]) => getForecastsMeta(...args),
	getMonitorsMeta: (...args: unknown[]) => getMonitorsMeta(...args),
	getDatasetCatalog: (...args: unknown[]) => getDatasetCatalog(...args)
}));

const { createDefaultMetadata } = await import("../../../src/lib/data/metadata.js");

const pm25 = { dataset: "air-quality", entryType: "pm25" };

function legacyMeta() {
	return {
		entries: {
			pm25: {
				label: "PM2.5",
				units: "µg/m³",
				levels: {
					GOOD: { name: "good", label: "Good", color: "#0f0", range: [0, 9], guidance: null },
					MODERATE: {
						name: "moderate",
						label: "Moderate",
						color: "#ff0",
						range: [9, 35.4],
						guidance: "Be careful"
					}
				}
			},
			o3: { label: "Ozone", units: "ppb", levels: null }
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
});

describe("default metadata", () => {
	it("shares one fetch between concurrent callers", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		const meta = createDefaultMetadata();
		const [a, b] = await Promise.all([meta.scale(pm25), meta.scale(pm25)]);
		expect(getMonitorsMeta).toHaveBeenCalledTimes(1);
		expect(a).toEqual(b);
	});

	it("builds a range scale from legacy levels", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		const scale = await createDefaultMetadata().scale(pm25);
		expect(scale).toMatchObject({ id: "pm25", label: "PM2.5", units: "µg/m³", kind: "range" });
		if (scale === "unavailable") throw new Error("unavailable");
		expect(scale.levels.map((l) => [l.min, l.max])).toEqual([
			[0, 9],
			[9, null]
		]);
	});

	it("uses a scale on the meta unchanged", async () => {
		const meta = legacyMeta();
		(meta.entries.pm25 as Record<string, unknown>).scale = pm25Scale;
		getMonitorsMeta.mockResolvedValue(meta);
		expect(await createDefaultMetadata().scale(pm25)).toBe(pm25Scale);
	});

	it("is unavailable for an unknown entry type, an entry without levels, and other datasets", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
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
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		const meta = createDefaultMetadata();
		expect(await meta.entryType(pm25)).toEqual({ label: "PM2.5", units: "µg/m³", precision: null });
		expect(await meta.entryType({ dataset: "air-quality", entryType: "o3" })).toEqual({
			label: "Ozone",
			units: "ppb",
			precision: null
		});
	});

	it("gives the catalog's display precision", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
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
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		getDatasetCatalog.mockRejectedValue(new Error("404"));
		expect(await createDefaultMetadata().entryType(pm25)).toMatchObject({
			label: "PM2.5",
			precision: null
		});
	});

	it("reads monitor type labels", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		const meta = createDefaultMetadata();
		expect(await meta.monitorTypeLabel("airgradient")).toBe("AirGradient");
		expect(await meta.monitorTypeLabel("zzz")).toBe("unavailable");
	});

	it("monitorTypeInterval returns expected_interval", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		expect(await createDefaultMetadata().monitorTypeInterval!("airgradient")).toBe("1 min");
	});

	it("unknown type is unavailable for monitorTypeInterval", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		expect(await createDefaultMetadata().monitorTypeInterval!("zzz")).toBe("unavailable");
	});

	it("is unavailable after a failed fetch and fetches again next time", async () => {
		getMonitorsMeta.mockRejectedValueOnce(new Error("down")).mockResolvedValue(legacyMeta());
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
		resolve(legacyMeta());
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
