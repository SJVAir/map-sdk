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
	});
});
