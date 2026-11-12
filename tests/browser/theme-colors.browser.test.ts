import { afterEach, describe, expect, it } from "vitest";
import { themeColors, themeSignature } from "../../src/lib/plugins/style.js";

let el: HTMLElement | null = null;
afterEach(() => el?.remove());

function container(vars: Record<string, string>): HTMLElement {
	el = document.createElement("div");
	for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
	document.body.append(el);
	return el;
}

describe("focus-area colors", () => {
	it("stay fixed whatever the theme's --foreground and --background", () => {
		const colors = themeColors(
			container({ "--foreground": "rgb(11, 22, 33)", "--background": "rgb(4, 5, 6)" })
		);
		expect(colors.focusArea).toBe("#1f2d3d");
		expect(colors.focusAreaCasing).toBe("#ffffff");
		expect(colors.focusAreaWash).toBe("#ffffff");
	});

	it("take a host's token overrides", () => {
		const colors = themeColors(
			container({
				"--foreground": "rgb(11, 22, 33)",
				"--background": "rgb(4, 5, 6)",
				"--focus-area": "rgb(7, 8, 9)",
				"--focus-area-casing": "rgb(10, 11, 12)",
				"--focus-area-wash": "rgb(13, 14, 15)"
			})
		);
		expect(colors.focusArea).toBe("rgba(7, 8, 9, 1)");
		expect(colors.focusAreaCasing).toBe("rgba(10, 11, 12, 1)");
		expect(colors.focusAreaWash).toBe("rgba(13, 14, 15, 1)");
	});

	it("are in the theme signature", () => {
		const node = container({ "--focus-area-wash": "rgb(1, 1, 1)" });
		const before = themeSignature(node);
		node.style.setProperty("--focus-area-wash", "rgb(2, 2, 2)");
		expect(themeSignature(node)).not.toBe(before);
	});
});
