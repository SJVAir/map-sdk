import { beforeEach, describe, expect, it, vi } from "vitest";
import { pm25Scale } from "../../fixtures/scales.js";

const getMonitorsMeta = vi.fn();
const getDatasetCatalog = vi.fn();
vi.mock("@sjvair/sdk", () => ({
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
		monitors: { airgradient: { label: "AirGradient" } }
	};
}

beforeEach(() => {
	getMonitorsMeta.mockReset();
	getDatasetCatalog.mockReset();
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
		expect(await meta.scale({ dataset: "hms", entryType: "smoke-density" })).toBe("unavailable");
		expect(await meta.entryType({ dataset: "hms", entryType: "smoke-density" })).toBe(
			"unavailable"
		);
	});

	it("gives label and units for an entry type", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		const meta = createDefaultMetadata();
		expect(await meta.entryType(pm25)).toEqual({ label: "PM2.5", units: "µg/m³" });
		expect(await meta.entryType({ dataset: "air-quality", entryType: "o3" })).toEqual({
			label: "Ozone",
			units: "ppb"
		});
	});

	it("reads monitor type labels", async () => {
		getMonitorsMeta.mockResolvedValue(legacyMeta());
		const meta = createDefaultMetadata();
		expect(await meta.monitorTypeLabel("airgradient")).toBe("AirGradient");
		expect(await meta.monitorTypeLabel("zzz")).toBe("unavailable");
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
				{ id: "hms", source: "" }
			]
		});
		const meta = createDefaultMetadata();
		expect(await meta.attribution("air-quality")).toBe("SJVAir");
		expect(await meta.attribution("hms")).toBe("unavailable");
		expect(await meta.attribution("other")).toBe("unavailable");
		expect(getDatasetCatalog).toHaveBeenCalledTimes(1);
	});

	it("is unavailable when the catalog fails", async () => {
		getDatasetCatalog.mockRejectedValue(new Error("404"));
		expect(await createDefaultMetadata().attribution("air-quality")).toBe("unavailable");
	});
});
