import { readFileSync } from "node:fs";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const theme = readFileSync(new URL("../../src/lib/theme.css", import.meta.url), "utf8");

/** The CSS Tailwind generates for `candidates` from the package's theme alone. */
async function build(candidates: string[]): Promise<string> {
	const compiler = await compile(`@import "theme.css";\n@tailwind utilities;`, {
		base: "/",
		loadStylesheet: async (id, base) => ({ path: id, base, content: theme })
	});
	return compiler.build(candidates);
}

describe("theme.css", () => {
	it("aliases each family token to a standard token when the host lacks it", async () => {
		const css = await build([
			"bg-highlight",
			"bg-highlight-subtle",
			"text-highlight-foreground",
			"border-card-border",
			"bg-overlay",
			"text-link",
			"shadow-card",
			"rounded-control"
		]);
		expect(css).toContain("background-color: var(--highlight, var(--primary))");
		expect(css).toContain("background-color: var(--highlight-subtle, var(--muted))");
		expect(css).toContain("color: var(--highlight-foreground, var(--primary-foreground))");
		expect(css).toContain("border-color: var(--card-border, var(--border))");
		expect(css).toContain("background-color: var(--overlay, var(--background))");
		expect(css).toContain("color: var(--link, var(--primary))");
		expect(css).toContain("box-shadow: var(--shadow-card, none)");
		expect(css).toContain("border-radius: var(--radius-control, var(--radius))");
	});

	it("never redeclares a host token, which would override the host's value", async () => {
		const css = await build(["shadow-card", "rounded-control", "bg-highlight", "text-link"]);
		for (const token of [
			"highlight",
			"highlight-subtle",
			"highlight-foreground",
			"card-border",
			"overlay",
			"link",
			"shadow-card",
			"radius-control"
		]) {
			expect(css, token).not.toMatch(new RegExp(`--${token}\\s*:`));
		}
	});
});
