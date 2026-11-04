import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
	test: {
		passWithNoTests: true,
		projects: [
			{
				// Server compile: rune modules' $effects never run here.
				plugins: [svelte()],
				test: {
					name: "unit",
					include: ["tests/unit/**/*.test.ts"],
					environment: "node"
				}
			},
			{
				// Client compile (see tests/client/environment.ts), so $effects run. No DOM.
				plugins: [svelte()],
				resolve: { conditions: ["browser"] },
				test: {
					name: "client",
					include: ["tests/client/**/*.test.ts"],
					environment: "./tests/client/environment.ts",
					// Inlined so Vite resolves them with the "browser" condition.
					server: { deps: { inline: ["svelte", "esm-env"] } }
				}
			},
			{
				plugins: [svelte()],
				resolve: { conditions: ["browser"] },
				test: {
					name: "browser",
					include: ["tests/browser/**/*.test.ts"],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }]
					}
				}
			}
		]
	}
});
