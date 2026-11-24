import { afterEach, describe, expect, it, vi } from "vitest";
import { SvelteSet } from "svelte/reactivity";
import { flushSync, tick, type Snippet } from "svelte";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeoJSONSourceSpecification } from "@maptiler/sdk";
import { createMap, type MapContext } from "../../../src/lib/core/create-map.svelte.js";
import type { MetadataProvider } from "../../../src/lib/data/metadata.js";
import type { ScaleRef } from "../../../src/lib/data/scale-types.js";
import type { MapFeatureProperties } from "../../../src/lib/data/types.js";
import { shapesPlugin } from "../../../src/lib/plugins/shapes.svelte.js";
import { shapesLens } from "../../../src/lib/plugins/shapes-lens.svelte.js";
import { legendSection, shareSections, type LegendEntry } from "../../../src/lib/ui/legend-data.js";
import { createDefaultFormat } from "../../../src/lib/data/format.js";
import { createFakeGl, type FakeGl } from "../../fixtures/fake-gl.js";
import { lensGrid, parentKey } from "../../fixtures/lens-grid.js";
import { pm25Scale } from "../../fixtures/scales.js";
import { DeepSource, TestSource } from "../../fixtures/sources.svelte.js";

type Props = MapFeatureProperties;
const SECTIONS: ScaleRef = { dataset: "pesticides", entryType: "section-lbs" };
const TOWNSHIPS: ScaleRef = { dataset: "pesticides", entryType: "township-lbs" };
const config = { maptilerKey: "test-key" };
const metadata = {
	scale: vi.fn(() => Promise.resolve(pm25Scale)),
	entryType: vi.fn(() => Promise.resolve("unavailable"))
} as unknown as MetadataProvider;

const stops: Array<() => void> = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
});

async function settle() {
	for (let i = 0; i < 4; i++) await Promise.resolve();
	flushSync();
}

async function setUp(
	opts: {
		children?: FeatureCollection<Geometry, Props>;
		tooltip?: () => Snippet | undefined;
		block?: (refKey: string) => string[];
		parentOf?: (p: Props) => string | null;
		deep?: boolean;
		meta?: MetadataProvider;
		legendDisplay?: "gradient" | "blocks";
		noFigure?: "neutral" | "outline";
		noFigureLabel?: string;
		detail?: (p: Props) => string | undefined;
		childrenLoaded?: (parentKey: string) => boolean;
	} = {}
) {
	const grid = lensGrid();
	const map = createMap({ config, metadata: opts.meta ?? metadata });
	const parentsSource = opts.deep
		? new DeepSource<Props>({ features: grid.parents, scale: TOWNSHIPS })
		: new TestSource<Props>({ features: grid.parents, scale: TOWNSHIPS });
	const childSource = new TestSource<Props>({
		features: opts.children ?? grid.children,
		scale: SECTIONS
	});
	const parents = shapesPlugin<Props>({
		id: "parents",
		source: parentsSource,
		layerLabel: "Townships",
		mode: "choropleth",
		zoomRange: { max: 11 }
	});
	const lens = shapesLens<Props>({
		id: "lens",
		parents,
		source: childSource,
		block: opts.block ?? grid.block,
		parentOf: opts.parentOf ?? grid.parentOf,
		layerLabel: "Sections",
		tooltip: opts.tooltip,
		legendUnits: "lbs per section",
		legendDisplay: opts.legendDisplay,
		noFigure: opts.noFigure,
		noFigureLabel: opts.noFigureLabel,
		detail: opts.detail,
		childrenLoaded: opts.childrenLoaded
	});
	map.addPlugin(parents);
	map.addPlugin(lens);
	const gl = createFakeGl({ styleLoaded: true });
	map.attach(gl);
	await tick();
	await settle();
	return { map, gl, parents, lens, grid, parentsSource, childSource };
}

const lensData = (gl: FakeGl, map: MapContext) =>
	(
		(gl.sources.get(`${map.uid}:lens:shapes`) as GeoJSONSourceSpecification | undefined)?.data as
			FeatureCollection | undefined
	)?.features.map((f) => f.properties!.refKey as string) ?? [];
const hiddenParents = (gl: FakeGl, map: MapContext) =>
	[...gl.featureStates.entries()]
		.filter(([k, v]) => k.startsWith(`${map.uid}:parents:shapes/`) && v.lensHidden)
		.map(([k]) => k.split("/")[1])
		.sort();

function hoverParent(map: MapContext, gl: FakeGl, key: string) {
	gl.setRenderedFeatures([
		{
			layer: { id: `${map.uid}:parents:fill` },
			source: `${map.uid}:parents:shapes`,
			properties: { refKey: key, name: key },
			geometry: { type: "Point", coordinates: [0, 0] }
		}
	]);
	gl.emit("mousemove", { point: { x: 1, y: 1 }, lngLat: { lng: 0.5, lat: 0.5 } });
	flushSync();
}

describe("shapesLens", () => {
	it("hovering a parent centres it and draws only that block's children", async () => {
		const { map, gl, lens } = await setUp();
		expect(lensData(gl, map)).toEqual([]);
		hoverParent(map, gl, parentKey(2, 2));
		await settle();
		expect(lens.center).toBe(parentKey(2, 2));
		const drawn = lensData(gl, map);
		expect(drawn).toHaveLength(36);
		expect(drawn.every((k) => /T[123]-[123]-S/.test(k))).toBe(true);
	});

	it("a parent hides only once one of its children is drawn", async () => {
		const grid = lensGrid();
		const onlyCentre = {
			...grid.children,
			features: grid.children.features.filter((f) =>
				f.properties.refKey.startsWith(`${parentKey(2, 2)}-`)
			)
		};
		const { map, gl, lens, childSource } = await setUp({ children: onlyCentre });
		lens.pin(parentKey(2, 2));
		await settle();
		expect(hiddenParents(gl, map)).toEqual([parentKey(2, 2)]);
		childSource.features = { ...grid.children };
		await settle();
		expect(hiddenParents(gl, map)).toHaveLength(9);
		lens.release();
		await settle();
		expect(hiddenParents(gl, map)).toEqual([]);
	});

	it("block names unknown parents and parentOf returns null: nothing draws, nothing throws", async () => {
		const { map, gl, lens } = await setUp({
			block: () => ["feature:nowhere"],
			parentOf: () => null
		});
		lens.pin(parentKey(2, 2));
		await settle();
		expect(lensData(gl, map)).toEqual([]);
		expect(hiddenParents(gl, map)).toEqual([]);
		expect(lens.legend!()).toBeNull();
	});

	it("draws the centre parent's outline over the children", async () => {
		const { map, gl, lens, grid } = await setUp();
		lens.pin(parentKey(1, 1));
		await settle();
		const ids = gl.layers.map((l) => l.id);
		const outline = `${map.uid}:lens:center-outline`;
		expect(ids.indexOf(outline)).toBeGreaterThan(ids.indexOf(`${map.uid}:lens:fill`));
		const data = (gl.sources.get(`${map.uid}:lens:center`) as GeoJSONSourceSpecification)
			.data as FeatureCollection;
		const centre = grid.parents.features.find((f) => f.properties.refKey === parentKey(1, 1))!;
		expect(data.features.map((f) => f.geometry)).toEqual([centre.geometry]);
	});

	it("lists the children only while pinned, never selectable", async () => {
		const { map, gl, lens } = await setUp();
		hoverParent(map, gl, parentKey(2, 2));
		await settle();
		expect(lens.features!()).toEqual([]);
		lens.pin(parentKey(2, 2));
		await settle();
		const items = lens.features!();
		expect(items).toHaveLength(36);
		expect(items.every((i) => i.selectable === false)).toBe(true);
	});

	it("passes noFigureLabel and detail to its children", async () => {
		// Each parent's first section has no reading, so no figure.
		const children = lensGrid({ value: (_key, n) => (n === 0 ? null : n) }).children;
		const { lens } = await setUp({
			children,
			noFigure: "outline",
			noFigureLabel: "Not enough data",
			detail: (p) => (p.value === null ? `why ${p.name}` : undefined)
		});
		lens.pin(parentKey(2, 2));
		await settle();
		const item = lens.features!().find((i) => i.name === "T2-2 S0")!;
		expect(item).toMatchObject({
			noFigure: true,
			noFigureLabel: "Not enough data",
			detail: "why T2-2 S0"
		});
		expect(lens.legend!()).toMatchObject({ noFigure: true, noFigureLabel: "Not enough data" });
	});

	it("passes legendDisplay to its legend", async () => {
		const { lens } = await setUp({ legendDisplay: "blocks" });
		lens.pin(parentKey(2, 2));
		await settle();
		const data = lens.legend!();
		expect(data && "scale" in data && data.display).toBe("blocks");
	});

	it("legends only while children are drawn, and shares a section with sections on the same ScaleRef", async () => {
		const { lens } = await setUp();
		expect(lens.legend!()).toBeNull();
		lens.pin(parentKey(2, 2));
		await settle();
		const data = lens.legend!();
		expect(data && "scale" in data && data.unitsLine).toBe("lbs per section");
		const format = createDefaultFormat();
		const sections = legendSection(
			{
				pluginId: "sections",
				title: "Sections",
				units: "lbs",
				scale: pm25Scale,
				scaleRef: SECTIONS
			},
			format
		)!;
		const entries: LegendEntry[] = [
			{ kind: "scale", section: legendSection(data!, format)! },
			{ kind: "scale", section: sections }
		];
		expect(shareSections(entries)).toHaveLength(1);
	});

	it("gives a child's tooltip from the lens's own tooltip option", async () => {
		const content = (() => {}) as unknown as Snippet;
		const tooltip = vi.fn(() => content);
		const { lens } = await setUp({ tooltip });
		lens.pin(parentKey(2, 2));
		await settle();
		expect(lens.tooltip!(lens.features!()[0])).toBe(content);
	});

	it("a restyle redraws a pinned lens and re-hides its parents", async () => {
		const { map, lens } = await setUp();
		lens.pin(parentKey(2, 2));
		await settle();
		const gl2 = createFakeGl({ styleLoaded: true });
		map.attach(gl2);
		await tick();
		await settle();
		expect(lens.pinned).toBe(true);
		expect(lensData(gl2, map)).toHaveLength(36);
		expect(hiddenParents(gl2, map)).toHaveLength(9);
	});

	it("drops and releases a pinned lens when the zoom leaves the parents' range", async () => {
		const { gl, lens } = await setUp();
		lens.pin(parentKey(2, 2));
		await settle();
		gl.jumpTo({ zoom: 12 });
		gl.emit("zoom", {});
		await settle();
		expect(lens.center).toBeNull();
		expect(lens.pinned).toBe(false);
		expect(lens.features!()).toEqual([]);
	});

	it("throws for a plain or non-shapes parent", () => {
		const grid = lensGrid();
		const plain = shapesPlugin<Props>({
			id: "p",
			source: new TestSource<Props>({ features: grid.parents, scale: TOWNSHIPS }),
			layerLabel: "P",
			mode: "plain"
		});
		const make = (parents: Parameters<typeof shapesLens>[0]["parents"]) =>
			shapesLens<Props>({
				id: "lens",
				parents,
				source: new TestSource<Props>({ features: grid.children, scale: SECTIONS }),
				block: grid.block,
				parentOf: grid.parentOf,
				layerLabel: "Sections"
			});
		const message = "map-sdk: shapesLens needs a choropleth shapesPlugin as parents";
		expect(() => make(plain)).toThrow(message);
		expect(() => make({ id: "x", setup: () => () => {} })).toThrow(message);
	});

	it("removing the parents drops and releases the lens", async () => {
		const { map, lens } = await setUp();
		lens.pin(parentKey(2, 2));
		await settle();
		map.removePlugin("parents");
		await settle();
		expect(lens.center).toBeNull();
		expect(lens.pinned).toBe(false);
		expect(lens.features!()).toEqual([]);
	});

	it("draws the centre outline from a deep $state parents source", async () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const { map, gl, lens } = await setUp({ deep: true });
		lens.pin(parentKey(1, 1));
		await settle();
		const data = (gl.sources.get(`${map.uid}:lens:center`) as GeoJSONSourceSpecification)
			.data as FeatureCollection;
		expect(data.features).toHaveLength(1);
		expect(errors).not.toHaveBeenCalled();
		errors.mockRestore();
	});

	it("keeps the parents filled while the children's scale is unresolved", async () => {
		const meta = {
			scale: vi.fn((ref: ScaleRef) =>
				ref.entryType === SECTIONS.entryType ? new Promise(() => {}) : Promise.resolve(pm25Scale)
			),
			entryType: vi.fn(() => Promise.resolve("unavailable"))
		} as unknown as MetadataProvider;
		const { map, gl, lens } = await setUp({ meta });
		lens.pin(parentKey(2, 2));
		await settle();
		expect(hiddenParents(gl, map)).toEqual([]);
	});

	it("refuses a pin for an unknown parent", async () => {
		const { lens } = await setUp();
		lens.pin("feature:nowhere");
		await settle();
		expect(lens.pinned).toBe(false);
	});

	it("draws children whose block parent isn't in the parents' data (the host's block decides)", async () => {
		const grid = lensGrid();
		const { map, gl, lens } = await setUp({
			block: (refKey) => [refKey, "feature:T9-9"],
			parentOf: (props) =>
				props.refKey.startsWith(`${parentKey(0, 0)}-`) ? "feature:T9-9" : grid.parentOf(props)
		});
		lens.pin(parentKey(2, 2));
		await settle();
		const drawn = lensData(gl, map);
		expect(drawn).toHaveLength(8);
		expect(drawn.filter((k) => k.startsWith(`${parentKey(0, 0)}-`))).toHaveLength(4);
		expect(hiddenParents(gl, map)).toEqual([parentKey(2, 2)]);
	});
});

describe("shapesLens hides its parents once the children have loaded", () => {
	const lensSource = (map: MapContext) => `${map.uid}:lens:shapes`;
	const blockOf = (grid: ReturnType<typeof lensGrid>, key: string) => grid.block(key).sort();

	async function held() {
		const set = await setUp();
		set.lens.pin(parentKey(2, 2));
		await settle();
		set.gl.holdData = true;
		return set;
	}

	it("keeps the old hidden set until the children's tiles load, then applies it whole", async () => {
		const { map, gl, lens, grid } = await held();
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 2)));
		lens.pin(parentKey(2, 3));
		await settle();
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 2)));
		gl.finishData(lensSource(map));
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 3)));
	});

	it("a metadata or content event doesn't apply it, though it says the source is loaded", async () => {
		const { map, gl, lens, grid } = await held();
		lens.pin(parentKey(2, 3));
		await settle();
		for (const sourceDataType of ["metadata", "content"]) {
			gl.emit("sourcedata", { sourceId: lensSource(map), isSourceLoaded: true, sourceDataType });
		}
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 2)));
	});

	it("a second recentre before the load applies only the latest", async () => {
		const { map, gl, lens, grid } = await held();
		lens.pin(parentKey(2, 3));
		await settle();
		lens.pin(parentKey(3, 3));
		await settle();
		gl.emit("sourcedata", { sourceId: lensSource(map), isSourceLoaded: false, tile: {} });
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 2)));
		gl.finishData(lensSource(map));
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(3, 3)));
	});

	it("an error on the children's source applies the pending set", async () => {
		const { map, gl, lens, grid } = await held();
		lens.pin(parentKey(2, 3));
		await settle();
		gl.failData(lensSource(map));
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 3)));
	});

	it("an event for another source doesn't apply it", async () => {
		const { map, gl, lens, grid } = await held();
		lens.pin(parentKey(2, 3));
		await settle();
		gl.emit("sourcedata", {
			sourceId: `${map.uid}:parents:shapes`,
			isSourceLoaded: true,
			tile: {}
		});
		gl.emit("error", { sourceId: `${map.uid}:parents:shapes`, error: new Error("other") });
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 2)));
	});

	it("a change that brings no new children applies at once", async () => {
		const { map, gl, grid, parentsSource } = await held();
		parentsSource.features = {
			...grid.parents,
			features: grid.parents.features.filter((f) => f.properties.refKey !== parentKey(1, 1))
		};
		await settle();
		expect(hiddenParents(gl, map)).toEqual(
			blockOf(grid, parentKey(2, 2)).filter((k) => k !== parentKey(1, 1))
		);
	});

	it("the children's scale going unavailable with a load pending shows the parents at once", async () => {
		const BROKEN: ScaleRef = { dataset: "pesticides", entryType: "broken" };
		const meta = {
			scale: vi.fn((ref: ScaleRef) =>
				ref.entryType === BROKEN.entryType
					? Promise.reject(new Error("no scale"))
					: Promise.resolve(pm25Scale)
			),
			entryType: vi.fn(() => Promise.resolve("unavailable"))
		} as unknown as MetadataProvider;
		const { map, gl, lens, childSource } = await setUp({ meta });
		lens.pin(parentKey(2, 2));
		await settle();
		gl.holdData = true;
		childSource.scale = BROKEN;
		await settle();
		await settle();
		expect(hiddenParents(gl, map)).toEqual([]);
	});

	it("the map's idle applies a pending set", async () => {
		const { map, gl, lens, grid } = await held();
		lens.pin(parentKey(2, 3));
		await settle();
		gl.emit("idle");
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 3)));
	});

	it("teardown with a load pending clears the hidden set and ignores later loads", async () => {
		const { map, gl, lens } = await held();
		lens.pin(parentKey(2, 3));
		await settle();
		const source = lensSource(map);
		map.removePlugin("lens");
		await settle();
		expect(hiddenParents(gl, map)).toEqual([]);
		gl.emit("sourcedata", { sourceId: source, isSourceLoaded: true, tile: {} });
		gl.emit("error", { sourceId: source, error: new Error("late") });
		gl.emit("idle");
		await settle();
		expect(hiddenParents(gl, map)).toEqual([]);
	});
});

describe("shapesLens childrenLoaded", () => {
	const lensSource = (map: MapContext) => `${map.uid}:lens:shapes`;
	const blockOf = (grid: ReturnType<typeof lensGrid>, key: string) => grid.block(key).sort();
	const PARTIAL = parentKey(1, 1);

	/** Pinned on (2,2) with the host holding all of the block but PARTIAL's children. */
	async function partly() {
		const block = lensGrid().block(parentKey(2, 2));
		const loaded = new SvelteSet(block.filter((k) => k !== PARTIAL));
		const set = await setUp({ childrenLoaded: (key) => loaded.has(key) });
		set.lens.pin(parentKey(2, 2));
		await settle();
		return { ...set, loaded };
	}

	it("a parent its host hasn't fully loaded stays shown under its drawn children", async () => {
		const { map, gl, grid } = await partly();
		expect(lensData(gl, map).some((k) => k.startsWith("feature:T1-1-"))).toBe(true);
		expect(hiddenParents(gl, map)).toEqual(
			blockOf(grid, parentKey(2, 2)).filter((k) => k !== PARTIAL)
		);
	});

	it("it hides once childrenLoaded says so, after the children's next load", async () => {
		const { map, gl, grid, loaded, childSource } = await partly();
		gl.holdData = true;
		loaded.add(PARTIAL);
		childSource.features = { ...grid.children, features: [...grid.children.features] };
		await settle();
		expect(hiddenParents(gl, map)).not.toContain(PARTIAL);
		gl.finishData(lensSource(map));
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 2)));
	});

	it("childrenLoaded turning true with no new children data hides at once", async () => {
		const { map, gl, grid, loaded } = await partly();
		loaded.add(PARTIAL);
		await settle();
		expect(hiddenParents(gl, map)).toEqual(blockOf(grid, parentKey(2, 2)));
	});
});
