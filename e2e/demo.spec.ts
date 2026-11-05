import { readFileSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type ConsoleMessage, type Locator, type Page } from "@playwright/test";

/**
 * The demo page against stubbed responses: `/api/` answers from `e2e/fixtures/*.json` and
 * MapTiler from a local empty style, so no server or key is needed.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url));

/** `/api/2.0/regions/geojson/?type=county` → `regions-geojson-county`. */
function fixtureName(url: URL): string {
	const path = url.pathname
		.replace(/^\/api\/2\.0\//, "")
		.replace(/\/$/, "")
		.replaceAll("/", "-");
	return path === "regions-geojson" ? `${path}-${url.searchParams.get("type")}` : path;
}

/** API paths without a fixture and uncaught page errors; both must stay empty. */
let missing: string[] = [];
let pageErrors: Error[] = [];
/** MapLibre's expression-evaluation warnings, from the page and its workers (tile parsing). */
let expressionWarnings: string[] = [];

async function stubNetwork(page: Page) {
	await page.route("**/api/**", async (route) => {
		const name = fixtureName(new URL(route.request().url()));
		let body: Buffer;
		try {
			body = fixture(name);
		} catch {
			missing.push(name);
			await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
			return;
		}
		await route.fulfill({ contentType: "application/json", body });
	});
	await page.route(/^https:\/\/api\.maptiler\.com\//, async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith("/style.json")) {
			await route.fulfill({
				contentType: "application/json",
				body: fixture("maptiler-empty-style")
			});
		} else {
			await route.fulfill({ status: 204, body: "" });
		}
	});
}

const leftMap = (page: Page) => page.getByRole("region", { name: "Date-range map" });
const rightMap = (page: Page) => page.getByRole("region", { name: "Live map" });
const selectionBox = (page: Page) =>
	page.getByRole("textbox", { name: "Monitors selection (JSON)" });

/** The monitor ids in the fixture, by name. */
const ALPHA = "AIHbqnQjQ0WkZi1a5_gEug";
const BRAVO = "B2_v7UeGR1iInmEDYv25dg";

async function openList(map: Locator): Promise<Locator> {
	const button = map.getByRole("button", { name: "List of features on the map" });
	if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
	return map.getByRole("listbox", { name: "Features on the map" });
}

async function load(page: Page) {
	await stubNetwork(page);
	await page.goto("/");
	await expect(leftMap(page).locator("canvas")).toBeVisible();
	// The monitors have loaded once the list shows them.
	const list = await openList(leftMap(page));
	await expect(list.getByRole("option", { name: /Fixture Alpha/ })).toBeVisible();
	await expect(page.getByTestId("live-status")).toHaveText("5 features");
}

test.beforeEach(async ({ page }) => {
	missing = [];
	pageErrors = [];
	expressionWarnings = [];
	page.on("pageerror", (error) => pageErrors.push(error));
	const onConsole = (message: ConsoleMessage) => {
		if (/^Expected value to be of type/.test(message.text())) {
			expressionWarnings.push(message.text());
		}
	};
	page.on("console", onConsole);
	page.on("worker", (worker) => worker.on("console", onConsole));
	await load(page);
});

test.afterEach(() => {
	expect(missing).toEqual([]);
	expect(pageErrors).toEqual([]);
});

test("the plugin layers evaluate without expression warnings", async ({ page }) => {
	// The stubbed basemap has no layers, so any warning comes from the plugins' expressions.
	// Tile parsing runs in workers shortly after the data arrives.
	await page.waitForTimeout(1000);
	expect(expressionWarnings).toEqual([]);
});

test("both maps render a canvas", async ({ page }) => {
	await expect(leftMap(page).locator("canvas")).toBeVisible();
	await expect(rightMap(page).locator("canvas")).toBeVisible();
});

test("credits line is present", async ({ page }) => {
	for (const map of [leftMap(page), rightMap(page)]) {
		const credits = map.locator(".maplibregl-ctrl-attrib");
		await expect(credits).toHaveCount(1);
		await expect(credits).toContainText("© MapTiler");
		await expect(credits).toContainText("© OpenStreetMap contributors");
	}
	await expect(page.locator("img[src*='logo.svg']")).toHaveCount(0);
});

test("the live map shows the same monitors from the live store", async ({ page }) => {
	const list = await openList(rightMap(page));
	await expect(list.getByRole("option", { name: /Fixture Alpha/ })).toBeVisible();
	await expect(list.getByRole("option", { name: /Fixture Bravo/ })).toBeVisible();
	await expect(page.getByRole("combobox", { name: "Pollutant" })).toHaveValue("pm25");
});

test("picking a monitor in the left list updates the editor and leaves the right map alone", async ({
	page
}) => {
	const list = await openList(leftMap(page));
	await list.getByRole("option", { name: /Fixture Alpha/ }).click();
	await expect(list.getByRole("option", { name: /Fixture Alpha/ })).toHaveAttribute(
		"aria-selected",
		"true"
	);
	expect(JSON.parse(await selectionBox(page).inputValue())).toEqual({
		kind: "monitors",
		ids: [ALPHA]
	});
	const rightList = await openList(rightMap(page));
	await expect(rightList.getByRole("option", { name: /Fixture Alpha/ })).toHaveAttribute(
		"aria-selected",
		"false"
	);
	await expect(rightMap(page).locator('[aria-selected="true"]')).toHaveCount(0);
	await expect(rightMap(page).getByRole("button", { name: /^Clear/ })).toHaveCount(0);
});

test("editing the selection JSON selects on the map", async ({ page }) => {
	await selectionBox(page).fill(JSON.stringify({ kind: "monitors", ids: [BRAVO] }));
	const list = await openList(leftMap(page));
	await expect(list.getByRole("option", { name: /Fixture Bravo/ })).toHaveAttribute(
		"aria-selected",
		"true"
	);
	await expect(list.getByRole("option", { name: /Fixture Alpha/ })).toHaveAttribute(
		"aria-selected",
		"false"
	);
});

test("hide then show keeps the camera and the selection", async ({ page }) => {
	await selectionBox(page).fill(JSON.stringify({ kind: "monitors", ids: [BRAVO] }));
	const camera = page.getByTestId("left-camera");
	const before = await camera.textContent();
	await leftMap(page)
		.getByRole("button", { name: /zoom in/i })
		.click();
	await expect(camera).not.toHaveText(before ?? "");
	const zoomed = await camera.textContent();

	const hide = page.getByRole("checkbox", { name: "Hide map" });
	await hide.check();
	await expect(leftMap(page).locator("canvas")).toHaveCount(0);
	const updates = Number(await camera.getAttribute("data-view-updates"));
	await hide.uncheck();
	await expect(leftMap(page).locator("canvas")).toBeVisible();
	// The rebuilt map reports its view once it loads; only then is the camera its own.
	await expect
		.poll(async () => Number(await camera.getAttribute("data-view-updates")))
		.toBeGreaterThan(updates);

	await expect(camera).toHaveText(zoomed ?? "");
	const list = await openList(leftMap(page));
	await expect(list.getByRole("option", { name: /Fixture Bravo/ })).toHaveAttribute(
		"aria-selected",
		"true"
	);
});

const LAYERS = [
	"Monitors",
	"Region fill",
	"CalHeatScore",
	"Forecast zones",
	"HMS smoke",
	"HMS fire"
];
/** Each layer's legend heading: its layer label, then the units if the scale has any. */
const LEGEND_SECTIONS = [
	/^Monitors/,
	/^Counties/,
	/^CalHeatScore/,
	/^Forecast zones/,
	/^Smoke/,
	/^Fires/
];

for (const theme of ["light", "dark"] as const) {
	test(`no WCAG 2.2 AA violations in the ${theme} theme`, async ({ page }) => {
		await page.getByRole("combobox", { name: "Theme" }).selectOption(theme);
		for (const name of LAYERS.slice(1)) await page.getByRole("checkbox", { name }).check();
		// Every layer has fixture data: wait until each has features and a legend section.
		const panel = page.getByRole("region", { name: "Date-range sources" });
		for (const name of LAYERS) {
			await expect(
				page.getByRole("checkbox", { name: new RegExp(`^${name} \\([1-9]\\d* features\\)$`) })
			).toBeVisible();
		}
		for (const heading of LEGEND_SECTIONS) {
			await expect(panel.getByRole("heading", { level: 3, name: heading })).toBeVisible();
		}
		const list = await openList(leftMap(page));
		await list.getByRole("option", { name: /Fixture Alpha/ }).click();
		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
			.analyze();
		expect(results.violations).toEqual([]);
	});
}

test("keyboard only: Tab reaches the map, the List button, and the list; Space selects", async ({
	page,
	browserName
}) => {
	// Safari and WebKit skip buttons on Tab unless "Press Tab to highlight each item" is on;
	// Option+Tab moves through every control.
	const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
	// A fresh page (the list closed), driven by keys alone from the top of the document.
	await page.reload();
	const left = leftMap(page);
	await expect(left.locator("canvas")).toBeVisible();

	async function tabUntil(target: Locator, limit = 40) {
		for (let i = 0; i < limit; i++) {
			await page.keyboard.press(tab);
			if (await target.evaluate((el) => el === document.activeElement)) return;
		}
		throw new Error("Tab never reached the target");
	}

	await tabUntil(left.locator("canvas"));
	// The credits' links sit between the canvas and the List button.
	const button = left.getByRole("button", { name: "List of features on the map" });
	await tabUntil(button, 5);
	await page.keyboard.press("Enter");
	const list = left.getByRole("listbox", { name: "Features on the map" });
	await expect(list.getByRole("option", { name: /Fixture Alpha/ })).toBeVisible();
	await tabUntil(list, 5);
	await page.keyboard.press("Space");
	await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
	expect(JSON.parse(await selectionBox(page).inputValue())).toMatchObject({ kind: "monitors" });
});
