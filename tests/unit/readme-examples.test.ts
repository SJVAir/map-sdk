import { describe, expect, it } from "vitest";
import {
	createMap,
	maptilerMap,
	monitorsPlugin,
	regionsPlugin,
	shapesPlugin
} from "../../src/lib/index.js";
import type { FeatureListItem, MapContext, MapPlugin, PluginContext } from "../../src/lib/index.js";
import {
	decodeRef,
	NO_LEVEL,
	staticSource,
	type FeatureRef,
	type MessageKey,
	type MessageParams,
	type MessageProvider,
	type SpatialSelection
} from "../../src/lib/data/index.js";
import { createMonitorsStore } from "../../src/lib/stores/index.js";
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

	it("a message provider (Paraglide-shaped)", () => {
		const catalog: Record<string, (params?: MessageParams) => string> = {
			mapsdk_list_button: () => "Lista"
		};
		const messages: MessageProvider = (key: MessageKey, params) => catalog[key]?.(params) ?? key;
		const map = createMap({ config: { maptilerKey: "" }, messages });
		expect(map.messages("mapsdk_list_button")).toBe("Lista");
		map.destroy();
	});
});
