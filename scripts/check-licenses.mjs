// Fails if any package whose modules end up in a bundle of the public entries has a license
// outside the allowlist. Like a host app, it bundles `.`, `./stores` and `./data` from dist/ and
// checks the packages those modules come from (not the whole `npm ls` tree, which includes
// unbundled tooling). Run through `npm run test:licenses`, which builds dist/ first.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const ALLOWED = new Set([
	"MIT",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"Apache-2.0",
	"ISC",
	"MPL-2.0",
	"0BSD"
]);
// First-party MIT; the JSR build has no license field (same exception the dashboard documents).
const EXCEPTIONS = new Set(["@jsr/sjvair__sdk"]);
// Expected once the entries import the map; reported when absent, never a failure.
const EXPECTED = ["maplibre-gl", "@maptiler/sdk", "@maptiler/client"];
const FIXTURE = "virtual:license-check";
const ENTRIES = [".", "./stores", "./data"];

// The package directory a node_modules file belongs to (handles scoped names and nesting).
function packageRoot(id) {
	const path = id.split("?")[0].replaceAll("\\", "/");
	const marker = "/node_modules/";
	const start = path.lastIndexOf(marker);
	if (start === -1) return null;
	const parts = path.slice(start + marker.length).split("/");
	const length = parts[0].startsWith("@") ? 2 : 1;
	return path.slice(0, start + marker.length) + parts.slice(0, length).join("/");
}

function licenseOf(dir) {
	const info = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	let raw = info.license ?? info.licenses;
	if (Array.isArray(raw)) raw = raw.map((l) => l.type ?? l).join(" OR ");
	else if (raw && typeof raw === "object") raw = raw.type;
	if (!raw) {
		const file = readdirSync(dir).find((name) => /^(licen[sc]e|copying)/i.test(name));
		if (file) raw = readFileSync(join(dir, file), "utf8").split("\n", 1)[0].trim();
	}
	return { name: info.name, version: info.version, license: raw || undefined };
}

// An SPDX expression passes when every AND operand has an allowed OR alternative.
function allowed(expression) {
	if (!expression) return false;
	return expression
		.replace(/[()]/g, "")
		.split(/\s+AND\s+/)
		.every((part) => part.split(/\s+OR\s+/).some((id) => ALLOWED.has(id.trim())));
}

const files = ENTRIES.map((subpath) => {
	const file = pkg.exports[subpath]?.svelte;
	return file && existsSync(resolve(root, file)) ? resolve(root, file) : null;
}).filter(Boolean);
const code =
	files.map((file, i) => `import * as m${i} from ${JSON.stringify(file)};`).join("\n") +
	`\nglobalThis.__keep = [${files.map((_, i) => `m${i}`).join(", ")}];\n`;

const result = await build({
	configFile: false,
	root,
	logLevel: "error",
	plugins: [
		{
			name: "license-check-fixture",
			resolveId: (id) => (id === FIXTURE ? "\0" + FIXTURE : null),
			load: (id) => (id === "\0" + FIXTURE ? code : null)
		},
		svelte()
	],
	build: { write: false, rolldownOptions: { input: FIXTURE } }
});

const roots = new Set();
for (const item of (Array.isArray(result) ? result[0] : result).output) {
	if (item.type !== "chunk") continue;
	for (const id of Object.keys(item.modules)) {
		const dir = packageRoot(id);
		if (dir) roots.add(dir);
	}
}

const checked = [...roots].map(licenseOf).sort((a, b) => a.name.localeCompare(b.name));
const failures = checked
	.filter((p) => !EXCEPTIONS.has(p.name) && !allowed(p.license))
	.map((p) => `${p.name}@${p.version}: ${p.license ?? "no license field"}`);

console.log(
	`Checked ${checked.length} bundled packages: ${checked.map((p) => p.name).join(", ") || "(none)"}`
);
const missing = EXPECTED.filter((name) => !checked.some((p) => p.name === name));
if (missing.length > 0)
	console.log(`Not bundled yet (expected until the entries import the map): ${missing.join(", ")}`);

if (failures.length > 0) {
	console.error("License check failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log("License check passed.");
