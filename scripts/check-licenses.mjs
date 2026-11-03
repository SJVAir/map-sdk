// Fails if any production dependency has a license outside the allowlist.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const tree = JSON.parse(
	execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "ignore"]
	})
);

const packages = new Map(); // "name@version" -> path
(function walk(deps) {
	for (const [name, info] of Object.entries(deps ?? {})) {
		if (info.path && info.version)
			packages.set(`${name}@${info.version}`, { name, path: info.path });
		walk(info.dependencies);
	}
})(tree.dependencies);

function licenseOf(dir) {
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const raw = pkg.license ?? pkg.licenses;
	if (Array.isArray(raw)) return raw.map((l) => l.type ?? l).join(" OR ");
	return typeof raw === "object" && raw ? raw.type : raw;
}

// An SPDX expression passes when every AND operand has at least one allowed OR alternative.
function allowed(expression) {
	if (!expression) return false;
	return expression
		.replace(/[()]/g, "")
		.split(/\s+AND\s+/)
		.every((part) => part.split(/\s+OR\s+/).some((id) => ALLOWED.has(id.trim())));
}

const failures = [];
for (const [id, { name, path }] of [...packages].sort()) {
	if (EXCEPTIONS.has(name)) continue;
	const license = licenseOf(path);
	if (!allowed(license)) failures.push(`${id}: ${license ?? "no license field"}`);
}

if (failures.length > 0) {
	console.error("License check failed:");
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log(`License check passed (${packages.size} production packages).`);
