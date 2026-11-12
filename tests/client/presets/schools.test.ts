import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, tick } from "svelte";
import type { GeoJSONSourceSpecification } from "@maptiler/sdk";
import type { FeatureCollection } from "geojson";
import { InteractionRouter } from "../../../src/lib/core/interactions.svelte.js";
import type { LegendData, Providers } from "../../../src/lib/core/plugin.js";
import { PluginHost } from "../../../src/lib/core/plugin-host.svelte.js";
import type { FormatProvider } from "../../../src/lib/data/format.js";
import { defaultMessages } from "../../../src/lib/data/messages.js";
import type { MetadataProvider } from "../../../src/lib/data/metadata.js";
import type { LocationType, SchoolsSource } from "../../../src/lib/data/types.js";
import { schoolsPlugin } from "../../../src/lib/presets/schools.svelte.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";
import { schoolRows, SchoolsTestSource } from "../../fixtures/sources.svelte.js";

const collection = schoolRows;
const Source = SchoolsTestSource;

function metadata(labels: Record<string, string | "unavailable" | Promise<string>> = {}) {
	return {
		scale: vi.fn(() => Promise.resolve("unavailable")),
		entryType: vi.fn(() => Promise.resolve("unavailable")),
		locationTypeLabel: vi.fn((type: string) => Promise.resolve(labels[type] ?? "unavailable"))
	} as unknown as MetadataProvider & { locationTypeLabel: ReturnType<typeof vi.fn> };
}

async function setup(
	source: SchoolsSource,
	options: { types?: readonly LocationType[] } = {},
	meta: MetadataProvider = metadata()
) {
	const providers: Providers = {
		metadata: meta,
		messages: defaultMessages,
		format: {} as FormatProvider
	};
	const host = new PluginHost({
		mapUid: "m1",
		providers,
		router: new InteractionRouter(),
		selectedKeys: () => new Set()
	});
	const plugin = schoolsPlugin({ source, layerLabel: "Schools", ...options });
	host.add(plugin);
	const gl = createFakeGl({ styleLoaded: true });
	host.attach(gl);
	await tick();
	await settle();
	return { host, plugin, gl };
}

async function settle() {
	for (let i = 0; i < 4; i++) await Promise.resolve();
	flushSync();
}

const sourceData = (gl: FakeGl, id: string) =>
	(gl.sources.get(id) as GeoJSONSourceSpecification | undefined)?.data as
		FeatureCollection | undefined;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	expect(errorSpy).not.toHaveBeenCalled();
	errorSpy.mockRestore();
});

describe("schoolsPlugin", () => {
	it("defaults its id, is not selectable, and marks places", () => {
		const plugin = schoolsPlugin({ source: new Source([]), layerLabel: "Schools" });
		expect(plugin.id).toBe("schools");
		expect(plugin.label).toBe("Schools");
		expect(plugin.selectable).toBe(false);
		expect(plugin.drawnAt).toBeTypeOf("function");
	});

	it("lists each site by its id and name, with its type_label until metadata answers", async () => {
		const { plugin } = await setup(new Source([{ name: "Lincoln Elementary" }]));
		const [item] = plugin.features!();
		expect(item.refKey).toBe("feature:s1");
		expect(item.ref).toEqual({ kind: "feature", id: "s1" });
		expect(item.name).toBe("Lincoln Elementary");
		expect(item.value).toBeNull();
		expect(item.selectable).toBe(false);
		expect(item.detail).toBe("Public School (CDE)");
	});

	it("lists both of two sites sharing coordinates", async () => {
		const at: [number, number] = [-119.7, 36.8];
		const { plugin } = await setup(new Source([{ at }, { at, type: "child_care" }]));
		expect(plugin.features!().map((i) => i.refKey)).toEqual(["feature:s1", "feature:s2"]);
	});

	it("filters by type, an allow-list", async () => {
		const source = new Source([
			{ type: "public_school" },
			{ type: "child_care" },
			{ type: "charter" }
		]);
		const all = await setup(source);
		expect(all.plugin.features!()).toHaveLength(3);
		const some = await setup(source, { types: ["child_care"] });
		expect(some.plugin.features!().map((i) => i.refKey)).toEqual(["feature:s2"]);
	});

	it("replaces type_label with the metadata's label once it answers", async () => {
		let resolve!: (label: string) => void;
		const meta = metadata({ public_school: new Promise((r) => (resolve = r)) });
		const { plugin } = await setup(new Source([{}]), {}, meta);
		expect(plugin.features!()[0].detail).toBe("Public School (CDE)");
		resolve("Public school");
		await settle();
		expect(plugin.features!()[0].detail).toBe("Public school");
	});

	it("keeps type_label when the metadata is unavailable", async () => {
		const { plugin } = await setup(new Source([{}]), {}, metadata({}));
		expect(plugin.features!()[0].detail).toBe("Public School (CDE)");
	});

	it("says Location when neither the metadata nor the feature has a label", async () => {
		const { plugin } = await setup(new Source([{ type_label: null }]), {}, metadata({}));
		expect(plugin.features!()[0].detail).toBe("Location");
	});

	it("works with a provider that has no locationTypeLabel", async () => {
		const meta = { scale: vi.fn(), entryType: vi.fn() } as unknown as MetadataProvider;
		const { plugin } = await setup(new Source([{}]), {}, meta);
		expect(plugin.features!()[0].detail).toBe("Public School (CDE)");
	});

	it("asks the metadata once per type", async () => {
		const meta = metadata({ public_school: "Public school" });
		const source = new Source([{}, {}]);
		await setup(source, {}, meta);
		source.features = collection([{}, {}, { type: "child_care" }]);
		await settle();
		const asked = meta.locationTypeLabel.mock.calls.map((c) => c[0]);
		// Each type once: the legend's three, though no private school is in the data.
		expect(asked.sort()).toEqual(["child_care", "private_school", "public_school"]);
	});

	it("draws school and child-care badges by kind", async () => {
		const { gl } = await setup(new Source([{}, { type: "child_care" }]));
		const school = sourceData(gl, "m1:schools:points:school")!;
		const care = sourceData(gl, "m1:schools:points:child-care")!;
		expect(school.features.map((f) => f.properties!["mapsdk:category"])).toEqual(["school"]);
		expect(care.features.map((f) => f.properties!["mapsdk:category"])).toEqual(["child-care"]);
		expect(gl.layers.some((l) => l.id === "m1:schools:points:school")).toBe(true);
	});

	it("clusters each kind in its own school-house bubbles with the count", async () => {
		const { gl } = await setup(new Source([{}, { type: "child_care" }]));
		const spec = gl.sources.get("m1:schools:points:school") as GeoJSONSourceSpecification;
		expect(spec.cluster).toBe(true);
		const bubble = (group: string) =>
			gl.layers.find((l) => l.id === `m1:schools:clusters:${group}`) as unknown as {
				type: string;
				layout: Record<string, unknown>;
			};
		for (const group of ["school", "child-care"]) {
			expect(bubble(group).type).toBe("symbol");
			expect(JSON.stringify(bubble(group).layout["icon-image"])).toContain(`bubble-${group}`);
			expect(bubble(group).layout["text-field"]).toEqual(["get", "point_count_abbreviated"]);
		}
		expect(gl.layers.some((l) => l.id.includes("cluster-count"))).toBe(false);
	});

	it("shows at every zoom by default", async () => {
		const { gl } = await setup(new Source([{}]));
		const layer = gl.layers.find((l) => l.id === "m1:schools:points:school") as unknown as {
			layout?: Record<string, unknown>;
		};
		expect(layer.layout?.visibility).toBeUndefined();
	});

	it("has one legend row per badge: School, then Child care from the metadata", async () => {
		const meta = metadata({ child_care: "Child care", public_school: "Public school" });
		const { plugin } = await setup(new Source([{ type: "child_care" }]), {}, meta);
		await settle();
		const data = plugin.legend!() as Extract<LegendData, { symbols: unknown }>;
		expect(data.title).toBe("Schools");
		expect(data.symbols.map((s) => s.label)).toEqual(["School", "Child care"]);
		expect(data.symbols[0].markup).toContain("--school-marker");
		expect(data.symbols[1].markup).toContain("--child-care-marker");
	});

	it("names the school row by its one type when the filter keeps only one", async () => {
		const meta = metadata({ private_school: "Private school" });
		const { plugin } = await setup(new Source([]), { types: ["private_school"] }, meta);
		await settle();
		const data = plugin.legend!() as Extract<LegendData, { symbols: unknown }>;
		expect(data.symbols.map((s) => s.label)).toEqual(["Private school"]);
	});

	it("leaves out the school row when the filter keeps only child care", async () => {
		const meta = metadata({ child_care: "Child care" });
		const { plugin } = await setup(new Source([]), { types: ["child_care"] }, meta);
		await settle();
		const data = plugin.legend!() as Extract<LegendData, { symbols: unknown }>;
		expect(data.symbols.map((s) => s.label)).toEqual(["Child care"]);
	});

	it("reports a loading source's status in the legend", async () => {
		const source = new Source([]);
		source.status = { state: "loading" };
		const { plugin } = await setup(source);
		expect(plugin.legend!()).toEqual({ pluginId: "schools", status: { state: "loading" } });
	});

	it("gives the host's own properties for a site", async () => {
		const { plugin } = await setup(new Source([{ source: "cde", external_id: "10621661013256" }]));
		const props = plugin.properties!("feature:s1");
		expect(props).toMatchObject({ id: "s1", source: "cde", external_id: "10621661013256" });
		expect(props).not.toHaveProperty("refKey");
		expect(() => structuredClone(props)).not.toThrow();
		expect(plugin.properties!("feature:nope")).toBeUndefined();
	});

	it("drops rows when the host replaces the features", async () => {
		const source = new Source([{}, {}]);
		const { plugin } = await setup(source);
		source.features = collection([{ id: "s9" }]);
		expect(plugin.features!().map((i) => i.refKey)).toEqual(["feature:s9"]);
	});
});
