import { describe, expect, it } from "vitest";
import { createMap, monitorsPlugin, regionsPlugin, shapesPlugin } from "../../src/lib/index.js";
import type { MapContext } from "../../src/lib/index.js";
import type { MapPlugin } from "../../src/lib/core/plugin.js";
import {
	decodeRef,
	staticSource,
	type FeatureRef,
	type MessageKey,
	type MessageParams,
	type MessageProvider,
	type MonitorFeatureProperties,
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

	it("selection: host-owned, featureclick, featuresAt, featureForElement", () => {
		const map: MapContext = createMap({ config: { maptilerKey: "" } });
		const plugin: MapPlugin = monitorsPlugin({
			source: createMonitorsStore().dataSource,
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
		expect(map.getSelection("monitors")).toEqual({ kind: "monitors", ids: ["abc"] });
		expect(decodeRef("monitor:abc")).toEqual({ kind: "monitor", id: "abc" });
		off();
		map.destroy();
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

	it("the monitor feature type", () => {
		const props: MonitorFeatureProperties | null = null;
		expect(props).toBeNull();
	});
});
