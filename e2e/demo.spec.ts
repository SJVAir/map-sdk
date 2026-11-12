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
const rightMap = (page: Page) => page.getByRole("region", { name: "Live map", exact: true });
const todayPanel = (page: Page) =>
	page.getByRole("region", { name: "Live map (monitor-map setup)", exact: true });
const todayMap = (page: Page) => page.getByRole("region", { name: "Monitor-map setup map" });
const selectionBox = (page: Page) =>
	page.getByRole("textbox", { name: "Monitors selection (JSON)" });

/** The monitor ids in the fixture, by name. */
const ALPHA = "AIHbqnQjQ0WkZi1a5_gEug";
const BRAVO = "B2_v7UeGR1iInmEDYv25dg";

/** Fixture Alpha's position (`e2e/fixtures/monitors.json`). */
const ALPHA_LNGLAT: [number, number] = [-119.74726, 36.874092];

type DemoMap = "left" | "right" | "today";

/** The parts of the demo's `MapContext`s (`window.__mapsdkDemo`) the card tests use. */
interface DemoContext {
	ready: boolean;
	plugins: Array<{ id: string }>;
	getSelection(id: string): { ids: string[] } | null;
	setSelection(id: string, selection: { kind: "monitors"; ids: string[] } | null): void;
	gl: {
		getCanvas(): HTMLCanvasElement;
		project(at: [number, number]): { x: number; y: number };
		once(type: string, listener: () => void): void;
		jumpTo(options: { center: [number, number]; zoom: number }): void;
	};
}

/** A position on one of the demo's maps, in page coordinates, with the map scrolled into view. */
async function monitorPoint(page: Page, map: DemoMap, lngLat: [number, number]) {
	await page.waitForFunction((m) => {
		const demo = (window as unknown as { __mapsdkDemo?: Record<string, { ready: boolean }> })
			.__mapsdkDemo;
		return demo?.[m]?.ready;
	}, map);
	await page.evaluate((m) => {
		const demo = (window as unknown as { __mapsdkDemo: Record<string, DemoContext> }).__mapsdkDemo;
		demo[m].gl.getCanvas().scrollIntoView({ block: "center" });
	}, map);
	return page.evaluate(
		([m, at]) => {
			const demo = (window as unknown as { __mapsdkDemo: Record<string, DemoContext> })
				.__mapsdkDemo;
			const gl = demo[m].gl;
			const p = gl.project(at);
			const box = gl.getCanvas().getBoundingClientRect();
			return { x: box.left + p.x, y: box.top + p.y };
		},
		[map, lngLat] as const
	);
}

/** Centers `map` on `lngLat` at zoom 14, past clustering, and waits for it to settle. */
async function zoomTo(page: Page, map: DemoMap, lngLat: [number, number]) {
	await monitorPoint(page, map, lngLat);
	await page.evaluate(
		([m, at]) =>
			new Promise<void>((resolve) => {
				const demo = (window as unknown as { __mapsdkDemo: Record<string, DemoContext> })
					.__mapsdkDemo;
				const gl = demo[m].gl;
				gl.once("idle", () => resolve());
				gl.jumpTo({ center: at, zoom: 14 });
			}),
		[map, lngLat] as const
	);
}

async function clickMonitor(page: Page, map: DemoMap, lngLat: [number, number]) {
	const { x, y } = await monitorPoint(page, map, lngLat);
	await page.mouse.move(x, y);
	await page.mouse.click(x, y);
}

/** The Live map's monitors selection ids, or null. */
async function liveSelection(page: Page): Promise<string[] | null> {
	return page.evaluate(() => {
		const demo = (window as unknown as { __mapsdkDemo: Record<string, DemoContext> }).__mapsdkDemo;
		return demo.right.getSelection("monitors")?.ids ?? null;
	});
}

/** The Live map's pinned card for Fixture Alpha. */
const card = (page: Page) => rightMap(page).getByRole("group", { name: /Fixture Alpha/ });

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
	await expect(page.getByTestId("today-status")).toHaveText("5 features");
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
	for (const map of [leftMap(page), rightMap(page), todayMap(page)]) {
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
	await expect(
		page.getByRole("region", { name: "Live monitors" }).getByRole("combobox", { name: "Pollutant" })
	).toHaveValue("pm25");
	await expect(todayPanel(page).getByRole("combobox", { name: "Pollutant" })).toHaveValue("pm25");
});

test("the monitor-map setup map renders its layers, engine controls and legend", async ({
	page
}) => {
	const map = todayMap(page);
	await expect(map.locator("canvas")).toBeVisible();
	// Engine controls (zoom/compass/locate), not map-sdk's buttons; no selection bar.
	await expect(map.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
	await expect(map.getByRole("button", { name: /^Clear/ })).toHaveCount(0);
	// Listed: monitors, collocation sites, smoke and the fire groups (hotspots are unlisted).
	const list = await openList(map);
	await expect(list.getByRole("option", { name: /Fixture Alpha/ })).toBeVisible();
	await expect(list.getByRole("option", { name: /Fixture Collocation Site/ })).toBeVisible();
	// Legend: top-first (pollutant, then the one fire section, then smoke).
	const headings = todayPanel(page).getByRole("heading", { level: 3 });
	await expect(headings.filter({ hasText: /^Fires/ })).toHaveCount(1);
	const texts = await headings.allTextContents();
	const at = (re: RegExp) => texts.findIndex((t) => re.test(t));
	expect(at(/^PM2\.5/)).toBeLessThan(at(/^Fires/));
	expect(at(/^Fires/)).toBeLessThan(at(/^Smoke/));
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
	/^PM2\.5/,
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
		for (const heading of [/^PM2\.5/, /^Fires/, /^Smoke/]) {
			await expect(
				todayPanel(page).getByRole("heading", { level: 3, name: heading })
			).toBeVisible();
		}
		const list = await openList(leftMap(page));
		await list.getByRole("option", { name: /Fixture Alpha/ }).click();
		// A pinned card on the Live map, so the scan covers it.
		await zoomTo(page, "right", ALPHA_LNGLAT);
		await clickMonitor(page, "right", ALPHA_LNGLAT);
		await expect(card(page)).toBeVisible();
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

test("keyboard only: monitor-map's focus-revealed List button top right", async ({
	page,
	browserName
}) => {
	const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
	const map = todayMap(page);
	await expect(map.locator("canvas")).toBeVisible();
	await todayPanel(page)
		.getByRole("combobox", { name: "List button corner" })
		.selectOption("top-right");
	await todayPanel(page)
		.getByRole("checkbox", { name: "Show the List button only on keyboard focus" })
		.check();
	const button = map.getByRole("button", { name: "List of features on the map" });
	const width = async () => (await button.boundingBox())?.width ?? 0;
	await expect.poll(width).toBeLessThanOrEqual(1);

	await map.locator("canvas").focus();
	for (let i = 0; i < 15; i++) {
		if (await button.evaluate((el) => el === document.activeElement)) break;
		await page.keyboard.press(tab);
	}
	await expect(button).toBeFocused();
	expect(await width()).toBeGreaterThan(1);
	// Below the engine's zoom/compass/locate-me controls.
	const controls = await map.locator(".maplibregl-ctrl-top-right").boundingBox();
	const box = await button.boundingBox();
	expect(box!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);

	await page.keyboard.press("Enter");
	const list = map.getByRole("listbox", { name: "Features on the map" });
	await expect(list.getByRole("option", { name: /Fixture Alpha/ })).toBeVisible();
	for (let i = 0; i < 5; i++) {
		if (await list.evaluate((el) => el === document.activeElement)) break;
		await page.keyboard.press(tab);
	}
	await expect(list).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(button).toBeFocused();
	expect(await width()).toBeGreaterThan(1);
	await page.keyboard.press(tab);
	await expect(button).not.toBeFocused();
	await expect.poll(width).toBeLessThanOrEqual(1);
});

test.describe("pinned card, touch", () => {
	test.use({ hasTouch: true });

	test("a tap on a monitor pins its card, and it stays", async ({ page }) => {
		await zoomTo(page, "right", ALPHA_LNGLAT);
		const { x, y } = await monitorPoint(page, "right", ALPHA_LNGLAT);
		await page.touchscreen.tap(x, y);
		await expect(card(page)).toBeVisible();
		await page.waitForTimeout(500);
		await expect(card(page)).toBeVisible();
	});
});

test("pinned card: a click pins it; a click on empty map closes it", async ({ page }) => {
	await zoomTo(page, "right", ALPHA_LNGLAT);
	await clickMonitor(page, "right", ALPHA_LNGLAT);
	await expect(card(page)).toBeVisible();
	// 100px left of Alpha, on the canvas, with no monitor there at zoom 14.
	const { x, y } = await monitorPoint(page, "right", ALPHA_LNGLAT);
	await page.mouse.click(x - 100, y);
	await expect(card(page)).toHaveCount(0);
});

test("pinned card: Escape closes it", async ({ page }) => {
	await zoomTo(page, "right", ALPHA_LNGLAT);
	await clickMonitor(page, "right", ALPHA_LNGLAT);
	await expect(card(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(card(page)).toHaveCount(0);
});

test("pinned card: Close closes it and the selection is unchanged", async ({ page }) => {
	await zoomTo(page, "right", ALPHA_LNGLAT);
	await clickMonitor(page, "right", ALPHA_LNGLAT);
	await expect(card(page)).toBeVisible();
	const selections = () =>
		page.evaluate(() => {
			const right = (window as unknown as { __mapsdkDemo: Record<string, DemoContext> })
				.__mapsdkDemo.right;
			return JSON.stringify(right.plugins.map((p: { id: string }) => right.getSelection(p.id)));
		});
	const before = await selections();
	await card(page).getByRole("button", { name: "Close" }).click();
	await expect(card(page)).toHaveCount(0);
	expect(await selections()).toBe(before);
});

test("pinned card, keyboard: a list row shows it; Tab reaches it; Escape returns to the row", async ({
	page
}) => {
	const list = await openList(rightMap(page));
	await list.focus();
	await page.keyboard.press("Home");
	// Sorted by name, so the first row is Fixture Alpha.
	const rowCard = card(page);
	await expect(rowCard).toBeVisible();
	// The card's first control: the host's Select on the Live map, then Close.
	await page.keyboard.press("Tab");
	await expect(rowCard.getByRole("button", { name: "Select" })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(rowCard).toHaveCount(0);
	await expect(list).toBeFocused();
});

test("the monitor-map setup map doesn't pin on click", async ({ page }) => {
	await zoomTo(page, "today", ALPHA_LNGLAT);
	await clickMonitor(page, "today", ALPHA_LNGLAT);
	await expect(todayMap(page).getByRole("group", { name: /Fixture Alpha/ })).toHaveCount(0);
});

test("modifier: a plain click pins and selects nothing", async ({ page }) => {
	await zoomTo(page, "right", ALPHA_LNGLAT);
	await clickMonitor(page, "right", ALPHA_LNGLAT);
	await expect(card(page)).toBeVisible();
	expect(await liveSelection(page)).toBeNull();
});

test("modifier: Shift-click selects, Shift-click again removes", async ({ page }) => {
	await zoomTo(page, "right", ALPHA_LNGLAT);
	const { x, y } = await monitorPoint(page, "right", ALPHA_LNGLAT);
	await page.keyboard.down("Shift");
	await page.mouse.click(x, y);
	await page.keyboard.up("Shift");
	await expect.poll(() => liveSelection(page)).toEqual([ALPHA]);
	await page.keyboard.down("Shift");
	await page.mouse.click(x, y);
	await page.keyboard.up("Shift");
	await expect.poll(() => liveSelection(page)).toBeNull();
});

test("modifier: the card's Select and Remove", async ({ page }) => {
	await zoomTo(page, "right", ALPHA_LNGLAT);
	await clickMonitor(page, "right", ALPHA_LNGLAT);
	await card(page).getByRole("button", { name: "Select" }).click();
	await expect.poll(() => liveSelection(page)).toEqual([ALPHA]);
	await card(page).getByRole("button", { name: "Remove" }).click();
	await expect.poll(() => liveSelection(page)).toBeNull();
	await expect(card(page)).toBeVisible();
});

test.describe("modifier, touch", () => {
	test.use({ hasTouch: true });

	test("a tap pins only; the card's Select selects", async ({ page }) => {
		await zoomTo(page, "right", ALPHA_LNGLAT);
		const { x, y } = await monitorPoint(page, "right", ALPHA_LNGLAT);
		await page.touchscreen.tap(x, y);
		await expect(card(page)).toBeVisible();
		expect(await liveSelection(page)).toBeNull();
		await card(page).getByRole("button", { name: "Select" }).tap();
		await expect.poll(() => liveSelection(page)).toEqual([ALPHA]);
	});
});

test("a pick past the cap is refused with an announced message", async ({ page }) => {
	await zoomTo(page, "right", ALPHA_LNGLAT);
	await page.evaluate(() => {
		const demo = (window as unknown as { __mapsdkDemo: Record<string, DemoContext> }).__mapsdkDemo;
		demo.right.setSelection("monitors", { kind: "monitors", ids: ["x1", "x2", "x3"] });
	});
	const { x, y } = await monitorPoint(page, "right", ALPHA_LNGLAT);
	await page.keyboard.down("Shift");
	await page.mouse.click(x, y);
	await page.keyboard.up("Shift");
	await expect(
		rightMap(page).getByRole("status").filter({ hasText: "Up to 3 monitors" })
	).toBeVisible();
	expect(await liveSelection(page)).toEqual(["x1", "x2", "x3"]);
});
