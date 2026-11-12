import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { createMap, type MapContext } from "../../src/lib/core/create-map.svelte.js";
import PickNotice from "../../src/lib/ui/PickNotice.svelte";

/** A map whose monitors plugin refuses every pick with `message`. */
function refusingMap(message: string): MapContext {
	const map = createMap({ config: { maptilerKey: "test-key" } });
	map.addPlugin(
		{ id: "monitors", setup: () => () => {} },
		{ selectionMode: "multiple", canSelect: () => message }
	);
	return map;
}

const refuse = (map: MapContext) => map.togglePick("monitors", { kind: "monitor", id: "a" });

afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
});

describe("PickNotice", () => {
	it("announces a refusal and clears it after 4 s", async () => {
		vi.useFakeTimers();
		const map = refusingMap("Up to 3 monitors");
		const { container } = await render(PickNotice, { map });
		const status = container.querySelector("[role=status]")!;
		expect(status.getAttribute("aria-live")).toBe("polite");
		expect(status.textContent?.trim()).toBe("");
		refuse(map);
		await vi.waitFor(() => expect(status.textContent?.trim()).toBe("Up to 3 monitors"));
		vi.advanceTimersByTime(4000);
		await vi.waitFor(() => expect(status.textContent?.trim()).toBe(""));
		expect(map.notice).toBeNull();
	});

	it("the same message twice is announced again", async () => {
		const map = refusingMap("Up to 3 monitors");
		const { container } = await render(PickNotice, { map });
		refuse(map);
		await vi.waitFor(() =>
			expect(container.querySelector(".mapsdk-pick-notice-text")).not.toBeNull()
		);
		const first = container.querySelector(".mapsdk-pick-notice-text");
		refuse(map);
		await vi.waitFor(() =>
			expect(container.querySelector(".mapsdk-pick-notice-text")).not.toBe(first)
		);
		expect(container.querySelector(".mapsdk-pick-notice-text")?.textContent).toBe(
			"Up to 3 monitors"
		);
	});

	it("one map's notice doesn't show on another", async () => {
		const one = refusingMap("From one");
		const two = refusingMap("From two");
		const a = await render(PickNotice, { map: one });
		const b = await render(PickNotice, { map: two });
		refuse(one);
		await vi.waitFor(() =>
			expect(a.container.querySelector("[role=status]")?.textContent?.trim()).toBe("From one")
		);
		expect(b.container.querySelector("[role=status]")?.textContent?.trim()).toBe("");
	});
});
