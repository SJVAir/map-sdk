import { afterEach, describe, expect, it } from "vitest";
import { createMap, type MapContext } from "../../../src/lib/core/create-map.svelte.js";
import type { FeatureListItem, MapPlugin } from "../../../src/lib/core/plugin.js";
import { NO_LEVEL } from "../../../src/lib/data/scale.js";

const config = { maptilerKey: "test-key" };

function item(id: string, name: string): FeatureListItem {
	return {
		refKey: `monitor:${id}`,
		ref: { kind: "monitor", id },
		name,
		value: null,
		level: NO_LEVEL,
		units: "",
		lngLat: [-119, 36],
		selectable: true
	};
}

function listed(id: string, items: FeatureListItem[]): MapPlugin {
	return { id, setup: () => () => {}, features: () => items };
}

/** A map root holding a list with one row per refKey, as MapView and FeatureList render them. */
function mapRoot(map: MapContext, refKeys: string[]): HTMLElement {
	const root = document.createElement("div");
	root.dataset.mapsdkMap = map.uid;
	const list = document.createElement("ul");
	for (const refKey of refKeys) {
		const row = document.createElement("li");
		row.dataset.mapsdkRef = refKey;
		row.append(document.createElement("span"));
		list.append(row);
	}
	root.append(list);
	document.body.append(root);
	return root;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("featureForElement", () => {
	it("resolves a row, or an element inside it, to its hit", () => {
		const map = createMap({ config });
		map.addPlugin(listed("monitors", [item("1", "Site 1"), item("2", "Site 2")]));
		const root = mapRoot(map, ["monitor:2"]);
		const row = root.querySelector("[data-mapsdk-ref]")!;
		const expected = {
			pluginId: "monitors",
			ref: { kind: "monitor", id: "2" },
			refKey: "monitor:2",
			name: "Site 2"
		};
		expect(map.featureForElement(row)).toEqual(expected);
		expect(map.featureForElement(row.querySelector("span")!)).toEqual(expected);
	});

	it("returns null for another map's row, even with the same plugin and ref", () => {
		const a = createMap({ config });
		const b = createMap({ config });
		a.addPlugin(listed("monitors", [item("1", "Site 1")]));
		b.addPlugin(listed("monitors", [item("1", "Site 1")]));
		const rootB = mapRoot(b, ["monitor:1"]);
		const rowB = rootB.querySelector("[data-mapsdk-ref]")!;
		expect(a.featureForElement(rowB)).toBeNull();
		expect(b.featureForElement(rowB)?.refKey).toBe("monitor:1");
	});

	it("returns null outside any row, outside any map, or for a ref no plugin lists", () => {
		const map = createMap({ config });
		map.addPlugin(listed("monitors", [item("1", "Site 1")]));
		const root = mapRoot(map, ["monitor:9"]);
		expect(map.featureForElement(root)).toBeNull();
		expect(map.featureForElement(root.querySelector("[data-mapsdk-ref]")!)).toBeNull();

		const loose = document.createElement("div");
		loose.dataset.mapsdkRef = "monitor:1";
		document.body.append(loose);
		expect(map.featureForElement(loose)).toBeNull();
	});
});
