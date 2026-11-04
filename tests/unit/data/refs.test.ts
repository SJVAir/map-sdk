import { describe, expect, it } from "vitest";
import {
	decodeRef,
	encodeRef,
	fromPlaceRef,
	selectionId,
	toPlaceRef
} from "../../../src/lib/data/refs.js";
import type { FeatureRef } from "../../../src/lib/data/types.js";
import type { PlaceRef } from "../../../src/lib/data/index.js";

describe("refs", () => {
	it("round-trips all three kinds", () => {
		const refs: FeatureRef[] = [
			{ kind: "monitor", id: "abc123" },
			{ kind: "region", type: "county", code: "06019" },
			{ kind: "feature", id: "smoke-1" }
		];
		for (const ref of refs) expect(decodeRef(encodeRef(ref))).toEqual(ref);
		expect(encodeRef(refs[0])).toBe("monitor:abc123");
		expect(encodeRef(refs[1])).toBe("region:county:06019");
		expect(encodeRef(refs[2])).toBe("feature:smoke-1");
	});

	it("splits a region key on the first two colons only", () => {
		expect(decodeRef("region:land_use:Fresno-x:1")).toEqual({
			kind: "region",
			type: "land_use",
			code: "Fresno-x:1"
		});
		const ref: FeatureRef = { kind: "region", type: "land_use", code: "Fresno-x:1" };
		expect(encodeRef(ref)).toBe("region:land_use:Fresno-x:1");
	});

	it("returns null for malformed keys", () => {
		expect(decodeRef("bogus")).toBeNull();
		expect(decodeRef("monitor:")).toBeNull();
		expect(decodeRef("region:county")).toBeNull();
		expect(decodeRef("region:county:")).toBeNull();
		expect(decodeRef("feature:")).toBeNull();
	});

	it("derives selection ids", () => {
		expect(selectionId({ kind: "region", type: "county", code: "06019" })).toBe("county:06019");
		expect(selectionId({ kind: "monitor", id: "m1" })).toBe("m1");
		expect(selectionId({ kind: "feature", id: "f1" })).toBeNull();
	});

	it("converts to and from place refs", () => {
		expect(toPlaceRef({ kind: "feature", id: "f1" })).toBeNull();
		const place: PlaceRef | null = toPlaceRef({ kind: "monitor", id: "m1" });
		expect(place).toEqual({ kind: "monitor", id: "m1" });
		expect(toPlaceRef({ kind: "region", type: "county", code: "1" })).toEqual({
			kind: "region",
			type: "county",
			code: "1"
		});
		expect(fromPlaceRef({ kind: "point", lat: 1, lon: 2 })).toBeNull();
		expect(fromPlaceRef({ kind: "monitor", id: "m1" })).toEqual({ kind: "monitor", id: "m1" });
		expect(fromPlaceRef({ kind: "region", type: "county", code: "1" })).toEqual({
			kind: "region",
			type: "county",
			code: "1"
		});
		expect(fromPlaceRef({ kind: "monitor" })).toBeNull();
	});
});
