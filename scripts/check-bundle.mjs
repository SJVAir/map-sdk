// Proves the light entries stay light: bundles each one from dist/ the way a host app would
// and fails if the map dependency is reachable from them, or an exports target is missing.
// Run through `npm run test:bundle`, which builds dist/ first.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundleFiles, root } from "./fixture-build.mjs";

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

// A module of the map engine, by its resolved path (not chunk text: a string such as a
// "© MapTiler" message is not the engine).
const HEAVY = /[\\/]node_modules[\\/](maplibre-gl|@maptiler[\\/])/;
const failures = [];

// Every exports target file must exist in dist/.
for (const [subpath, entry] of Object.entries(pkg.exports)) {
	if (typeof entry !== "object" || entry === null) {
		failures.push(`"${subpath}" export is not an object with conditions`);
		continue;
	}
	for (const [condition, file] of Object.entries(entry)) {
		if (!existsSync(resolve(root, file))) {
			failures.push(`"${subpath}" export's "${condition}" file is missing: ${file}`);
		}
	}
}

function entryFile(subpath) {
	const file = typeof pkg.exports[subpath] === "object" ? pkg.exports[subpath]?.svelte : undefined;
	if (!file) {
		failures.push(`package.json has no "${subpath}" export with a "svelte" condition`);
		return null;
	}
	return resolve(root, file);
}

// Bundles a module that imports everything from `file` and returns the chunks loaded up
// front (the entry and its static imports).
async function eagerChunks(file) {
	const chunks = await bundleFiles([file]);
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
	if (eager.some((chunk) => chunk.moduleIds.some((id) => HEAVY.test(id)))) {
		failures.push(`"${subpath}" pulls the map dependency into the startup bundle`);
	}
}

if (failures.length > 0) {
	console.error("\nBundle check failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}

console.log("Bundle check passed.");
