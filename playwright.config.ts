import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;

export default defineConfig({
	testDir: "e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 1280, height: 900 },
		trace: "retain-on-failure"
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }
		},
		{
			name: "firefox",
			use: {
				...devices["Desktop Firefox"],
				viewport: { width: 1280, height: 900 },
				// CI machines have no GPU; let Firefox use software WebGL (CI also runs it under Xvfb).
				launchOptions: { firefoxUserPrefs: { "webgl.force-enabled": true } }
			}
		},
		{
			name: "webkit",
			use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } }
		}
	],
	webServer: {
		command: `npx vite dev --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		// Never reuse a running dev server: it would carry the developer's real key.
		reuseExistingServer: false,
		// A placeholder key: MapTiler requests are routed to a local style, so no real key is needed,
		// and the environment wins over `.env`, so a developer's key never reaches the tests.
		env: { VITE_MAPTILER_KEY: "e2e-placeholder" }
	}
});
