import type { Scale } from "@sjvair/sdk/meta/types";
import { describe, expect, it } from "vitest";
import type { Level } from "../../../src/lib/data/scale-types.js";
import { burnScale, fireScale, heatScale, pm25Scale, smokeScale } from "../../fixtures/scales.js";

describe("scale types", () => {
	it("type-checks the fixtures as the SDK's Scale (checked by svelte-check)", () => {
		const scales = [pm25Scale, smokeScale, fireScale, heatScale, burnScale] satisfies Scale[];
		expect(scales).toHaveLength(5);
	});

	it("keeps Level as an alias of the SDK's level type", () => {
		const level: Level = pm25Scale.levels[0];
		const sdkLevel: Scale["levels"][number] = level;
		expect(sdkLevel.key).toBe("good");
	});
});
