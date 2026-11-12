import type { FeatureCollection, Point } from "geojson";
import { describe, expect, expectTypeOf, it } from "vitest";
import en from "../../../src/lib/data/messages/en.json";
import type {
	DataSource,
	LocationType,
	MapFeatureProperties,
	SchoolLocationProperties,
	SchoolsSource
} from "../../../src/lib/data/index.js";

describe("school location types", () => {
	it("names the three location types", () => {
		expectTypeOf<LocationType>().toEqualTypeOf<"public_school" | "private_school" | "child_care">();
	});

	it("takes getPesticideLocations' features as they are", () => {
		const features: FeatureCollection<Point, SchoolLocationProperties> = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					geometry: { type: "Point", coordinates: [-119.8, 36.75] },
					properties: {
						id: "s1",
						source: "cde",
						external_id: "10621661013256",
						name: "Lincoln Elementary",
						type: "public_school",
						type_label: "Public school",
						address: "1 Main St",
						city: null,
						school_district: null,
						school_district_id: null,
						school_district_url: null,
						grade_span: "K-6",
						enrollment: 420,
						capacity: null
					}
				}
			]
		};
		const source: SchoolsSource = { status: { state: "ready" }, features };
		expect(source.features?.features).toHaveLength(1);
	});

	it("accepts a DataSource holding those properties", () => {
		type Props = SchoolLocationProperties & MapFeatureProperties;
		expectTypeOf<DataSource<Props>>().toMatchTypeOf<SchoolsSource>();
	});

	it("has a generic location label", () => {
		expect(en.mapsdk_location_type_unknown).toBe("Location");
	});
});
