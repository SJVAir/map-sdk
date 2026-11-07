import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CI runs in Playwright's Docker image, which ships one Playwright release's browsers. The
// tests' Playwright must be that same release, or the browsers they ask for aren't there.
describe("CI's Playwright image", () => {
	it("matches the installed Playwright version", () => {
		const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
		const image = ci.match(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-/);
		expect(image, "ci.yml runs in mcr.microsoft.com/playwright:v<version>-…").not.toBeNull();
		const lock = JSON.parse(
			readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8")
		);
		const installed = lock.packages["node_modules/playwright"].version;
		expect(image![1]).toBe(installed);
	});
});
