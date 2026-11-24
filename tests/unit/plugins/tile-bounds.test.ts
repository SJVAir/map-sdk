import { describe, expect, it } from "vitest";
import { tileBounds } from "../../../src/lib/plugins/tile-bounds.js";

const MAX_LAT = 85.0511287798066;

describe("tileBounds", () => {
	it("the world tile at zoom 0", () => {
		const b = tileBounds({ tileID: { canonical: { z: 0, x: 0, y: 0 } } })!;
		expect(b[0]).toBeCloseTo(-180, 4);
		expect(b[1]).toBeCloseTo(-MAX_LAT, 4);
		expect(b[2]).toBeCloseTo(180, 4);
		expect(b[3]).toBeCloseTo(MAX_LAT, 4);
	});

	it("the north-east quarter at zoom 1", () => {
		const b = tileBounds({ tileID: { canonical: { z: 1, x: 1, y: 0 } } })!;
		expect(b[0]).toBeCloseTo(0, 4);
		expect(b[1]).toBeCloseTo(0, 4);
		expect(b[2]).toBeCloseTo(180, 4);
		expect(b[3]).toBeCloseTo(MAX_LAT, 4);
	});

	it("anything without a canonical tile id is null", () => {
		for (const tile of [{}, null, undefined, { tileID: {} }, { tileID: { canonical: { z: 1 } } }]) {
			expect(tileBounds(tile)).toBeNull();
		}
	});
});
