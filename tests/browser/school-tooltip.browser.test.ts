import { tick } from "svelte";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { createMap } from "../../src/lib/core/create-map.svelte.js";
import { createDefaultFormat } from "../../src/lib/data/format.js";
import { defaultMessages } from "../../src/lib/data/messages.js";
import type { SchoolLocationProperties } from "../../src/lib/data/types.js";
import SchoolTooltip from "../../src/lib/presets/SchoolTooltip.svelte";
import MapTooltip from "../../src/lib/ui/MapTooltip.svelte";
import { schoolsPlugin } from "../../src/lib/presets/schools.svelte.js";
import { createFakeGl } from "../fixtures/fake-gl.js";
import { schoolRows, SchoolsTestSource } from "../fixtures/sources.svelte.js";

const format = createDefaultFormat();

function lines(): string[] {
	return [...document.querySelectorAll(".mapsdk-school-line")].map(
		(el) => el.textContent?.replace(/\s+/g, " ").trim() ?? ""
	);
}

function site(props: Partial<SchoolLocationProperties>): SchoolLocationProperties {
	return { id: "s1", name: "Lincoln Elementary", type: "public_school", ...props };
}

describe("SchoolTooltip", () => {
	it("shows a full school's lines in order", () => {
		render(SchoolTooltip, {
			site: site({
				address: "1 Main St",
				city: "Fresno",
				school_district: "Fresno Unified",
				grade_span: "K-6",
				enrollment: 1234,
				capacity: 99
			}),
			typeLabel: "Public school",
			messages: defaultMessages,
			format
		});
		expect(lines()).toEqual([
			"Public school",
			"1 Main St, Fresno",
			"District: Fresno Unified",
			"Grades: K-6",
			"Enrollment: 1,234"
		]);
	});

	it("shows child care's capacity, including 0, and never enrollment", () => {
		render(SchoolTooltip, {
			site: site({ type: "child_care", address: "2 Elm St", capacity: 0, enrollment: 50 }),
			typeLabel: "Child care",
			messages: defaultMessages,
			format
		});
		expect(lines()).toEqual(["Child care", "2 Elm St", "Capacity: 0"]);
	});

	it("leaves out missing, null, and blank values", () => {
		render(SchoolTooltip, {
			site: site({
				address: "1 Main St",
				city: null,
				school_district: "  ",
				grade_span: null,
				enrollment: null
			}),
			typeLabel: "Public school",
			messages: defaultMessages,
			format
		});
		expect(lines()).toEqual(["Public school", "1 Main St"]);
		expect(document.body.textContent).not.toMatch(/null|undefined/);
	});
});

describe("schoolsPlugin with a map", () => {
	it("closes a pinned card when its school leaves the data", async () => {
		const source = new SchoolsTestSource([{ name: "Lincoln Elementary" }, { name: "Roosevelt" }]);
		const map = createMap({ config: { maptilerKey: "test-key" } });
		map.addPlugin(schoolsPlugin({ source, layerLabel: "Schools" }));
		const gl = createFakeGl({ styleLoaded: true });
		map.attach(gl);
		await tick();
		map.setCardEnabled(true);
		render(MapTooltip, { map, card: true, project: () => ({ x: 100, y: 100 }) });
		const id = `${map.uid}:schools:points:school`;
		gl.setRenderedFeatures([
			{
				layer: { id },
				source: id,
				properties: { refKey: "feature:s1", name: "Lincoln Elementary" },
				geometry: { type: "Point", coordinates: [-119.8, 36.75] }
			}
		] as never);
		gl.emit("click", {
			point: { x: 1, y: 2 },
			lngLat: { lng: -119.8, lat: 36.75 },
			originalEvent: {}
		});
		await tick();
		expect(map.pinned?.hit.refKey).toBe("feature:s1");
		source.features = schoolRows([{ id: "s2", name: "Roosevelt" }]);
		await tick();
		await tick();
		expect(map.pinned).toBeNull();
	});
});
