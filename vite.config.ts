import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
	plugins: [svelte()],
	build: {
		target: ["chrome111", "edge111", "firefox128", "safari16.4"]
	}
});
