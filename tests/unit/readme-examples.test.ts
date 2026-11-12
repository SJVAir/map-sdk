import { describe, expect, it } from "vitest";
import type { ComponentProps } from "svelte";
import {
	circle,
	collocationSitesPlugin,
	CROSSHAIR_ICON_SIZE,
	createMap,
	defaultBasemaps,
	focusAreaPlugin,
	hmsFirePlugin,
	hmsSmokePlugin,
	Legend,
	maptilerMap,
	monitorsPlugin,
	pointsPlugin,
	regionsPlugin,
	schoolsPlugin,
	shapesPlugin,
	withCrosshair
} from "../../src/lib/index.js";
import type {
	CustomLayerInterface,
	FeatureListItem,
	FeatureListOptions,
	MapContext,
	MapPlugin,
	PluginContext
} from "../../src/lib/index.js";
import {
	decodeRef,
	NO_LEVEL,
	staticSource,
	type FeatureRef,
	type MessageKey,
	type MessageParams,
	type MessageProvider,
	type SchoolsSource,
	type SpatialSelection
} from "../../src/lib/data/index.js";
import {
	createCollocationSitesStore,
	createHmsFireStore,
	createHmsSmokeStore,
	createMonitorsStore
} from "../../src/lib/stores/index.js";
import type { FeatureCollection, Point } from "geojson";

// The README's examples, compiled by `npm run check` (they are type-checked against the real
// exports) and run here where they need no map engine.

describe("README examples", () => {
	it("minimal map: createMap, monitorsPlugin on a store", () => {
		const store = createMonitorsStore();
		const map = createMap({ config: { maptilerKey: "your-maptiler-key" } });
		map.addPlugin(
			monitorsPlugin({ source: store.dataSource, layerLabel: "Monitors", selectable: true }),
			{
				selectionMode: "multiple",
				onselectionchange: (selection: SpatialSelection | null) => void selection
			}
		);
		expect(map.plugins.map((p) => p.id)).toEqual(["monitors"]);
		map.destroy();
		store.dispose();
	});

	it("MapView's featureList options, as monitor-map uses them", () => {
		const featureList: FeatureListOptions = { position: "top-right", reveal: "focus" };
		expect(featureList).toEqual({ position: "top-right", reveal: "focus" });
	});

	it("today's basemaps without the POI layer filter", () => {
		const basemaps = { ...defaultBasemaps(), excludedLayers: [] };
		const map = createMap({ config: { maptilerKey: "your-maptiler-key", basemaps } });
		expect(basemaps.styles.length).toBeGreaterThan(0);
		expect(basemaps.excludedLayers).toEqual([]);
		map.destroy();
	});

	it("maptilerMap is null while detached", () => {
		const map = createMap({ config: { maptilerKey: "your-maptiler-key" } });
		expect(map.ready).toBe(false);
		expect(maptilerMap(map)).toBeNull();
		map.destroy();
	});

	it("static GeoJSON through shapesPlugin and staticSource", () => {
		const places: FeatureCollection<Point, { refKey: string; name: string; value: number }> = {
			type: "FeatureCollection",
			features: []
		};
		const map = createMap({ config: { maptilerKey: "" } });
		const source = staticSource(places, { dataset: "air-quality", entryType: "pm25" });
		map.addPlugin(shapesPlugin({ id: "sites", source, layerLabel: "Sites", mode: "choropleth" }));
		map.addPlugin(regionsPlugin({ source, layerLabel: "Counties" }), { before: "sites" });
		map.movePlugin("sites");
		expect(map.plugins.map((p) => p.id)).toEqual(["regions", "sites"]);
		map.destroy();
	});

	it("a shapes layer that takes no hover", () => {
		const plumes: FeatureCollection<Point, { refKey: string; name: string; value: string }> = {
			type: "FeatureCollection",
			features: []
		};
		const map = createMap({ config: { maptilerKey: "k" } });
		const source = staticSource(plumes, { dataset: "hms-smoke", entryType: "smoke-density" });
		map.addPlugin(
			shapesPlugin({
				id: "plumes",
				source,
				layerLabel: "Plumes",
				mode: "choropleth",
				hoverable: false
			})
		);
		expect(map.plugins[0].hoverable).toBe(false);
		map.destroy();
	});

	it("a frameless legend inside a host's card", () => {
		const map = createMap({ config: { maptilerKey: "k" } });
		const props: ComponentProps<typeof Legend> = { map, framed: false };
		expect(props.framed).toBe(false);
		map.destroy();
	});

	it("a detail for features with no level", () => {
		type Charger = { refKey: string; name: string; value: null; level: 2 | 3 };
		const plugin = pointsPlugin<Charger>({
			id: "ev",
			layerLabel: "EV chargers",
			circle: { radius: 6 },
			detail: (p) => `Level ${p.level} charger`,
			source: staticSource({ type: "FeatureCollection", features: [] }, null)
		});
		expect(plugin.id).toBe("ev");
		const row: Pick<FeatureListItem, "detail"> = { detail: "Level 2 charger" };
		expect(row.detail).toBe("Level 2 charger");
	});

	it("writing a plugin: setup through the context, features for the list", () => {
		type Sites = FeatureCollection<Point, { refKey: string; name: string }>;

		function sitesPlugin(sites: Sites): MapPlugin {
			return {
				id: "sites",
				label: "Sites",
				setup(ctx: PluginContext) {
					const source = ctx.addSource("sites", { type: "geojson", data: sites });
					const layer = ctx.addLayer("dots", {
						type: "circle",
						source,
						paint: { "circle-radius": 5 }
					});
					ctx.interactive([layer], (props) => {
						const ref = decodeRef(String(props.refKey));
						const name = String(props.name);
						return ref && { pluginId: "sites", ref, refKey: String(props.refKey), name };
					});
					return () => {};
				},
				features: (): FeatureListItem[] =>
					sites.features.flatMap(({ properties: { refKey, name }, geometry }) => {
						const ref = decodeRef(refKey);
						const [lng, lat] = geometry.coordinates;
						if (!ref) return [];
						const lngLat: [number, number] = [lng, lat];
						return [
							{
								refKey,
								ref,
								name,
								value: null,
								level: NO_LEVEL,
								units: "",
								lngLat,
								selectable: false
							}
						];
					})
			};
		}

		const sites: Sites = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: { type: "Point", coordinates: [-119.8, 36.7] },
					properties: { refKey: "feature:fresno", name: "Fresno" }
				}
			]
		};
		const map = createMap({ config: { maptilerKey: "" } });
		map.addPlugin(sitesPlugin(sites));
		expect(map.plugins[0].features!()).toEqual([
			expect.objectContaining({ name: "Fresno", ref: { kind: "feature", id: "fresno" } })
		]);
		map.destroy();
	});

	it("writing a plugin: a custom layer", () => {
		class WindLayer implements CustomLayerInterface {
			readonly type = "custom";
			constructor(readonly id: string) {}
			onAdd() {}
			render() {}
			onRemove() {}
		}

		const windPlugin: MapPlugin = {
			id: "wind",
			label: "Wind",
			setup(ctx: PluginContext) {
				ctx.addCustomLayer("particles", (id) => new WindLayer(id));
				return () => {};
			}
		};

		const map = createMap({ config: { maptilerKey: "" } });
		map.addPlugin(windPlugin);
		expect(map.plugins.map((p) => p.id)).toEqual(["wind"]);
		map.destroy();
	});

	it("selection: host-owned, featureclick, featuresAt, featureForElement", () => {
		const map: MapContext = createMap({ config: { maptilerKey: "" } });
		const store = createMonitorsStore();
		const plugin: MapPlugin = monitorsPlugin({
			source: store.dataSource,
			layerLabel: "Monitors"
		});
		map.addPlugin(plugin);
		map.setSelection("monitors", { kind: "monitors", ids: ["abc"] });
		const off = map.on(
			"featureclick",
			({ pluginId, ref }: { pluginId: string; ref: FeatureRef }) => void [pluginId, ref]
		);
		const onContextMenu = (event: MouseEvent) => {
			const hits = map.featuresAt({ x: event.offsetX, y: event.offsetY });
			const row = event.target instanceof Element ? map.featureForElement(event.target) : null;
			return [hits, row];
		};
		expect(onContextMenu).toBeTypeOf("function");
		map.flyTo({ center: [-119.7, 36.7], zoom: 16 });
		map.easeTo({ center: [-119.7, 36.7], minZoom: 12 });
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["abc"] });
		expect(decodeRef("monitor:abc")).toEqual({ kind: "monitor", id: "abc" });
		off();
		map.destroy();
		store.dispose();
	});

	it("selection: modifier picks, a cap through canSelect, and togglePick", () => {
		const map: MapContext = createMap({ config: { maptilerKey: "" } });
		const store = createMonitorsStore();
		map.addPlugin(monitorsPlugin({ source: store.dataSource, layerLabel: "Monitors" }), {
			selectionMode: "multiple",
			pickWith: "modifier",
			canSelect: (next) => (next?.ids.length ?? 0) <= 3 || "Up to 3 monitors"
		});
		map.setSelection("monitors", { kind: "monitors", ids: ["a", "b", "c"] });
		map.togglePick("monitors", { kind: "monitor", id: "d" });
		expect(map.getSelection("monitors")?.ids).toEqual(["a", "b", "c"]);
		expect(map.notice?.message).toBe("Up to 3 monitors");
		expect(map.getPickWith("monitors")).toBe("modifier");
		map.destroy();
		store.dispose();
	});

	it("a message provider (Paraglide-shaped)", () => {
		const catalog: Record<string, (params?: MessageParams) => string> = {
			mapsdk_list_button: () => "Lista"
		};
		const messages: MessageProvider = (key: MessageKey, params) => catalog[key]?.(params) ?? key;
		const map = createMap({ config: { maptilerKey: "" }, messages });
		expect(map.messages("mapsdk_list_button")).toBe("Lista");
		map.destroy();
	});

	it("HMS stores feed the HMS plugins", () => {
		const smoke = createHmsSmokeStore();
		const fires = createHmsFireStore();
		const map = createMap({ config: { maptilerKey: "your-maptiler-key" } });
		map.addPlugin(hmsSmokePlugin({ source: smoke.dataSource, layerLabel: "Smoke" }));
		map.addPlugin(
			hmsFirePlugin({ source: fires.groups, hotspots: fires.hotspots, layerLabel: "Fires" })
		);
		expect(map.plugins.map((p) => p.id)).toEqual(["hms-smoke", "hms-fire"]);
		smoke.dispose();
		fires.dispose();
	});

	it("collocation sites draw under the monitors from a store joined to them", () => {
		const monitors = createMonitorsStore();
		const collocations = createCollocationSitesStore({ monitors });
		const map = createMap({ config: { maptilerKey: "your-maptiler-key" } });
		map.addPlugin(
			collocationSitesPlugin({ source: collocations.dataSource, layerLabel: "Collocation sites" })
		);
		map.addPlugin(monitorsPlugin({ source: monitors.dataSource, layerLabel: "Monitors" }));
		expect(map.plugins.map((p) => p.id)).toEqual(["collocation-sites", "monitors"]);
		expect(collocations.dataSource.features).toBeNull();
		collocations.dispose();
		monitors.dispose();
		map.destroy();
	});

	it("marker shapes in a crosshair", () => {
		const svg = withCrosshair(circle("#00e400", 2), "#4A5FC6");
		expect(svg).toContain(`width="${CROSSHAIR_ICON_SIZE}"`);
	});

	it("focus area: added under the data, set in place", () => {
		const map = createMap({ config: { maptilerKey: "your-maptiler-key" } });
		map.addPlugin(monitorsPlugin({ source: createMonitorsStore().dataSource, layerLabel: "M" }));
		const focus = focusAreaPlugin({ layerLabel: "Places" });
		map.addPlugin(focus, { before: "monitors" });
		focus.set({
			geometry: { type: "Point", coordinates: [-119.79, 36.74] },
			label: "Your location"
		});
		expect(map.plugins.map((p) => p.id)).toEqual(["focus-area", "monitors"]);
		expect(focus.features!()[0].name).toBe("Your location");
		map.destroy();
	});

	it("schools: getPesticideLocations' features as they are, a type filter, featureclick properties", async () => {
		// Stands in for @sjvair/sdk's getPesticideLocations({ region }): one site in any region.
		const site: NonNullable<SchoolsSource["features"]>["features"][number] = {
			type: "Feature",
			geometry: { type: "Point", coordinates: [-119.8, 36.75] },
			properties: {
				id: "s1",
				source: "cde-public",
				external_id: "10621666006068",
				name: "Addams Elementary",
				type: "public_school",
				type_label: "Public school"
			}
		};
		const getPesticideLocations = async (params: { region: string }) =>
			({ type: "FeatureCollection", features: params.region ? [site] : [] }) as const;
		const region = "rb2rf";
		const map = createMap({ config: { maptilerKey: "your-maptiler-key" } });
		map.addPlugin(monitorsPlugin({ source: createMonitorsStore().dataSource, layerLabel: "M" }));
		const schools = schoolsPlugin({
			source: { status: { state: "ready" }, features: await getPesticideLocations({ region }) },
			layerLabel: "Schools and child care",
			types: ["public_school", "private_school"]
		});
		map.addPlugin(schools, { before: "monitors" });
		const seen: unknown[] = [];
		map.on("featureclick", (e) => {
			if (e.pluginId === "schools") seen.push(e.properties?.external_id);
		});
		map.pickFromList("schools", "feature:s1", false);
		expect(seen).toEqual(["10621666006068"]);
		map.destroy();
	});
});
