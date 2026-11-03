// Shared by the bundle and license checks: bundles a virtual module that imports everything
// from `files` (the way a host app would) and returns the output chunks.
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export const root = fileURLToPath(new URL("../", import.meta.url));
const FIXTURE = "virtual:check-fixture";

export async function bundleFiles(files) {
	const code =
		files.map((file, i) => `import * as m${i} from ${JSON.stringify(file)};`).join("\n") +
		`\nglobalThis.__keep = [${files.map((_, i) => `m${i}`).join(", ")}];\n`;

	const result = await build({
		configFile: false,
		root,
		logLevel: "error",
		plugins: [
			{
				name: "check-fixture",
				resolveId: (id) => (id === FIXTURE ? "\0" + FIXTURE : null),
				load: (id) => (id === "\0" + FIXTURE ? code : null)
			},
			svelte()
		],
		build: { write: false, rolldownOptions: { input: FIXTURE } }
	});

	return (Array.isArray(result) ? result[0] : result).output.filter(
		(item) => item.type === "chunk"
	);
}
