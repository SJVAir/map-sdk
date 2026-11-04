import type { FeatureCollection, Point } from "geojson";
import { describe, expect, it } from "vitest";
import { staticSource } from "../../../src/lib/data/static-source.js";
import type { MapFeatureProperties } from "../../../src/lib/data/types.js";

describe("staticSource", () => {
	it("is ready and exposes the same features and scale", () => {
		const fc: FeatureCollection<Point, MapFeatureProperties> = {
			type: "FeatureCollection",
			features: []
		};
		const ref = { dataset: "pm25", entryType: "monitor" };
		const src = staticSource(fc, ref);
		expect(src.status).toEqual({ state: "ready" });
		expect(src.features).toBe(fc);
		expect(src.scale).toBe(ref);
		expect(staticSource(fc, null).scale).toBeNull();
	});
});
