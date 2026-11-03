// Proves the light entries stay light: bundles each one from dist/ the way a host app would
// and fails if the map dependency is reachable from them, or an exports target is missing.
// Run through `npm run test:bundle`, which builds dist/ first.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const HEAVY = /maplibre|maptiler/i;
const FIXTURE = "virtual:bundle-check";
const failures = [];

// Every exports target file must exist in dist/.
for (const [subpath, entry] of Object.entries(pkg.exports)) {
	for (const [condition, file] of Object.entries(entry)) {
		if (!existsSync(resolve(root, file))) {
			failures.push(`"${subpath}" export's "${condition}" file is missing: ${file}`);
		}
	}
}

function entryFile(subpath) {
	const file = pkg.exports[subpath]?.svelte;
	if (!file) {
		failures.push(`package.json has no "${subpath}" export with a "svelte" condition`);
		return null;
	}
	return resolve(root, file);
}

// Bundles a module that imports everything from `file` and returns the chunks loaded up
// front (the entry and its static imports).
async function eagerChunks(file) {
	const code = `import * as m from ${JSON.stringify(file)};\n` + `globalThis.__keep = [m];\n`;

	const result = await build({
		configFile: false,
		root,
		logLevel: "error",
		plugins: [
			{
				name: "bundle-check-fixture",
				resolveId: (id) => (id === FIXTURE ? "\0" + FIXTURE : null),
				load: (id) => (id === "\0" + FIXTURE ? code : null)
			},
			svelte()
		],
		build: { write: false, rolldownOptions: { input: FIXTURE } }
	});

	const output = (Array.isArray(result) ? result[0] : result).output;
	const chunks = output.filter((item) => item.type === "chunk");
	const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
	const eager = new Set();
	const queue = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName);
	while (queue.length > 0) {
		const name = queue.pop();
		if (eager.has(name)) continue;
		eager.add(name);
		queue.push(...byName.get(name).imports);
	}
	return chunks.filter((chunk) => eager.has(chunk.fileName));
}

for (const subpath of ["./stores", "./data"]) {
	const file = entryFile(subpath);
	if (!file || !existsSync(file)) continue;
	const eager = await eagerChunks(file);
	const kb = (eager.reduce((total, chunk) => total + chunk.code.length, 0) / 1024).toFixed(0);
	console.log(`${subpath.padEnd(9)} eager ${kb} KB`);
	if (eager.some((chunk) => HEAVY.test(chunk.code))) {
		failures.push(`"${subpath}" pulls the map dependency into the startup bundle`);
	}
}

if (failures.length > 0) {
	console.error("\nBundle check failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log("Bundle check passed.");
