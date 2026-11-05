import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("package.json", () => {
	it("is MIT licensed", () => {
		expect(pkg.license).toBe("MIT");
	});

	it("gives the JS entries svelte, types, and default conditions", () => {
		for (const subpath of [".", "./stores", "./data"]) {
			const conditions = pkg.exports[subpath];
			expect(conditions, subpath).toHaveProperty("svelte");
			expect(conditions, subpath).toHaveProperty("types");
			expect(conditions, subpath).toHaveProperty("default");
		}
	});

	it("gives the non-JS entries a default condition", () => {
		for (const subpath of ["./messages/en.json", "./theme.css"]) {
			expect(pkg.exports[subpath], subpath).toHaveProperty("default");
		}
	});

	it("keeps @sjvair/sdk and svelte as peers, not dependencies", () => {
		expect(pkg.peerDependencies).toHaveProperty("@sjvair/sdk");
		expect(pkg.peerDependencies).toHaveProperty("svelte");
		expect(pkg.dependencies).not.toHaveProperty("@sjvair/sdk");
		expect(pkg.dependencies).not.toHaveProperty("svelte");
		// Nothing uses UI primitives, so there's no bits-ui peer to install.
		expect(Object.keys(pkg.peerDependencies).sort()).toEqual(["@sjvair/sdk", "svelte"]);
	});

	it("runs on Node 26 and later", () => {
		expect(pkg.engines.node).toBe(">=26");
	});

	it("exports the hosts' components and helpers from the root, not internal helpers", () => {
		const index = readFileSync(new URL("../../src/lib/index.ts", import.meta.url), "utf8");
		const exported = [...index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((m) =>
			m[1].split(",").map((name) =>
				name
					.trim()
					.split(/\s+as\s+/)
					.pop()!
			)
		);
		for (const name of [
			"MapView",
			"defaultBasemaps",
			"Legend",
			"MapTooltip",
			"FeatureList",
			"SelectionBar",
			"ViewSummary",
			"MapControls",
			"legendSection",
			"summaryText",
			"rowLabel",
			"pointsPlugin",
			"shapesPlugin",
			"monitorsPlugin",
			"monitorShape",
			"regionsPlugin",
			"calHeatScorePlugin",
			"forecastZonesPlugin",
			"hmsSmokePlugin",
			"hmsFirePlugin",
			"groupFires",
			"cleanFires",
			"collocationSitesPlugin",
			"COLLOCATION_CROSSHAIR_COLOR",
			"circle",
			"square",
			"triangle",
			"withCrosshair",
			"levelKeyExpression",
			"colorExpression",
			"opacityExpression",
			// Types for writing a plugin.
			"MapPlugin",
			"PluginContext",
			"FeatureHit",
			"FeatureListItem",
			"LegendData",
			"Providers",
			"GlMapLike",
			"LayerSpecWithoutId",
			"ThemeColors",
			"ClusterLayers",
			"ClusterLayerArgs",
			"BlockingClick",
			"Hovered"
		]) {
			expect(exported, name).toContain(name);
		}
		for (const name of [
			"optionIdPart",
			"typeaheadIndex",
			"swatchOverBackground",
			"LegendBar",
			"PluginHost",
			"InteractionRouter"
		]) {
			expect(exported, name).not.toContain(name);
		}
	});

	it("publishes through npm trusted publishing, prereleases to the next tag", () => {
		const release = readFileSync(
			new URL("../../.github/workflows/release.yml", import.meta.url),
			"utf8"
		);
		expect(release).toContain("id-token: write");
		expect(release).toContain("npm install -g npm@latest");
		expect(release).toContain("npm publish --access public --provenance --tag next");
		expect(release).not.toContain("NPM_TOKEN");
		expect(release).not.toContain("NODE_AUTH_TOKEN");
		expect(release).toContain("github.event.release.tag_name");
	});
});
