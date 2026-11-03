import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("package.json", () => {
	it("is MIT licensed", () => {
		expect(pkg.license).toBe("MIT");
	});

	it("gives every export subpath svelte, types, and default conditions", () => {
		const subpaths = Object.entries<Record<string, string>>(pkg.exports);
		expect(subpaths.length).toBeGreaterThan(0);
		for (const [subpath, conditions] of subpaths) {
			expect(conditions, subpath).toHaveProperty("svelte");
			expect(conditions, subpath).toHaveProperty("types");
			expect(conditions, subpath).toHaveProperty("default");
		}
	});

	it("keeps @sjvair/sdk and svelte as peers, not dependencies", () => {
		expect(pkg.peerDependencies).toHaveProperty("@sjvair/sdk");
		expect(pkg.peerDependencies).toHaveProperty("svelte");
		expect(pkg.dependencies).not.toHaveProperty("@sjvair/sdk");
		expect(pkg.dependencies).not.toHaveProperty("svelte");
	});
});
