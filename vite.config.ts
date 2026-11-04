import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

// The dev server serves the demo page (demo/), not shipped in the package; `npm run build` is
// svelte-package and doesn't read this file. Vitest has its own config.
export default defineConfig({
	root: fileURLToPath(new URL("./demo", import.meta.url)),
	// `.env` (VITE_MAPTILER_KEY) lives at the repo root, not in demo/.
	envDir: fileURLToPath(new URL(".", import.meta.url)),
	plugins: [
		tailwindcss(),
		svelte({ configFile: fileURLToPath(new URL("./svelte.config.js", import.meta.url)) })
	],
	server: {
		// The local sjvair.com stack; the demo calls the API on its own origin.
		proxy: { "/api/": "http://localhost:8000" },
		fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] }
	},
	build: {
		target: ["chrome111", "edge111", "firefox128", "safari16.4"]
	}
});
