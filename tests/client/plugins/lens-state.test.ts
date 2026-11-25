import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { createLensState } from "../../../src/lib/plugins/lens-state.svelte.js";
import { cardOn, FakeLensInputs, hover } from "../../fixtures/lens-inputs.svelte.js";

let stops: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	for (const stop of stops) stop();
	stops = [];
	vi.useRealTimers();
});

function lens() {
	const inputs = new FakeLensInputs();
	const state = createLensState(inputs);
	stops.push(state.start());
	flushSync();
	return { inputs, state };
}

const step = (ms = 0) => {
	flushSync();
	vi.advanceTimersByTime(ms);
	flushSync();
};

describe("createLensState", () => {
	it("hovering a parent centres the lens", () => {
		const { inputs, state } = lens();
		expect(state.center).toBeNull();
		inputs.parentHover = hover("parents", "T1");
		step();
		expect(state.center).toBe("T1");
		expect(state.pinned).toBe(false);
	});

	it("hovering a drawn child of a neighbour recentres", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.childHover = hover("lens", "T2-S5");
		step();
		expect(state.center).toBe("T2");
	});

	it("leaving both drops after 120 ms, not before", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.parentHover = null;
		step(119);
		expect(state.center).toBe("T1");
		step(1);
		expect(state.center).toBeNull();
	});

	it("coming back within the grace keeps it", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.parentHover = null;
		step(100);
		inputs.parentHover = hover("parents", "T1");
		step(500);
		expect(state.center).toBe("T1");
	});

	it("a recentre cancels a scheduled drop", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.parentHover = null;
		step(60);
		inputs.childHover = hover("lens", "T2-S1");
		step(500);
		expect(state.center).toBe("T2");
	});

	it("a parent under another plugin's marker keeps the lens", () => {
		// The parent's own hover stays set (hoverOf sees through the notice on top).
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.parentHover = hover("parents", "T1", false, [1, 1]);
		step(1000);
		expect(state.center).toBe("T1");
	});

	it("the pointer in the card keeps the lens; leaving the card starts the grace", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.inCard = true;
		inputs.parentHover = null;
		step(1000);
		expect(state.center).toBe("T1");
		inputs.inCard = false;
		step(119);
		expect(state.center).toBe("T1");
		step(1);
		expect(state.center).toBeNull();
	});

	it("touch hover never raises the lens", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1", true);
		step(1000);
		expect(state.center).toBeNull();
	});

	it("Esc drops an unpinned lens until the parent hover changes", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		state.escape();
		step();
		expect(state.center).toBeNull();
		inputs.parentHover = hover("parents", "T1", false, [2, 2]);
		step();
		expect(state.center).toBeNull();
		inputs.parentHover = hover("parents", "T2");
		step();
		expect(state.center).toBe("T2");
		state.escape();
		inputs.parentHover = null;
		step();
		inputs.parentHover = hover("parents", "T2");
		step();
		expect(state.center).toBe("T2");
	});

	it("pin centres and pins; hover doesn't move it; release unpins and drops", () => {
		const { inputs, state } = lens();
		state.pin("T1");
		step();
		expect(state.center).toBe("T1");
		expect(state.pinned).toBe(true);
		inputs.parentHover = hover("parents", "T3");
		step(1000);
		expect(state.center).toBe("T1");
		inputs.parentHover = null;
		step(1000);
		expect(state.center).toBe("T1");
		state.release();
		step();
		expect(state.pinned).toBe(false);
		expect(state.center).toBeNull();
	});

	it("a pinned card on a parent doesn't pin; on a drawn child it holds; closing it lets go", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.card = cardOn("parents", "T1");
		step();
		expect(state.pinned).toBe(false);
		inputs.parentHover = hover("parents", "T2");
		step();
		expect(state.center).toBe("T2");
		inputs.card = cardOn("lens", "T2-S3");
		step();
		expect(state.held).toBe(true);
		inputs.parentHover = hover("parents", "T3");
		step(1000);
		expect(state.center).toBe("T2");
		inputs.card = null;
		step();
		expect(state.held).toBe(false);
		expect(state.center).toBe("T3");
	});

	it("a section card or a notice card inside the block holds a hover lens; one outside doesn't", () => {
		// The user, 2026-11-16 (0.1.0-beta.18): a notice's card holds it just as a section's does.
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.card = cardOn("notices", "feature:n1", [1, 1]);
		step();
		expect(state.held).toBe(true);
		inputs.parentHover = hover("parents", "T3");
		step(1000);
		expect(state.center).toBe("T1");
		inputs.card = cardOn("notices", "feature:n2", [50, 1]);
		step();
		expect(state.held).toBe(false);
		expect(state.center).toBe("T3");
		inputs.card = cardOn("lens", "T3-S2");
		step();
		expect(state.held).toBe(true);
	});

	it("a held lens stays held when the card moves to its centre township", () => {
		// The user, 2026-11-17 (0.1.0-beta.20): a section card's "In township" swaps in the
		// township's card (MapContext.pin) and keeps the lens.
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.card = cardOn("lens", "T1-S2");
		step();
		expect(state.held).toBe(true);
		inputs.card = cardOn("parents", "T1");
		step();
		expect(state.held).toBe(true);
		inputs.parentHover = hover("parents", "T3");
		step(1000);
		expect(state.center).toBe("T1");
		inputs.card = null;
		step();
		expect(state.held).toBe(false);
		expect(state.center).toBe("T3");
	});

	it("the carried hold ends when the card moves on to another township", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.card = cardOn("lens", "T1-S2");
		step();
		inputs.card = cardOn("parents", "T1");
		step();
		expect(state.held).toBe(true);
		inputs.card = cardOn("parents", "T2");
		step();
		expect(state.held).toBe(false);
		inputs.parentHover = hover("parents", "T3");
		step();
		expect(state.center).toBe("T3");
	});

	it("a centre township's card that didn't come from a held card doesn't hold", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.card = cardOn("parents", "T1");
		step();
		expect(state.held).toBe(false);
		inputs.parentHover = hover("parents", "T2");
		step();
		expect(state.center).toBe("T2");
	});

	it("list focus moving the held card to the centre township doesn't carry the hold", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.card = cardOn("lens", "T1-S2");
		step();
		expect(state.held).toBe(true);
		inputs.focus = "T1";
		inputs.card = cardOn("parents", "T1");
		step();
		expect(state.held).toBe(false);
	});

	it("a pinned lens is released when the pinned card closes or moves outside the block", () => {
		const { inputs, state } = lens();
		inputs.card = cardOn("parents", "T1");
		state.pin("T1");
		step();
		inputs.card = cardOn("lens", "T1-S2");
		step();
		expect(state.pinned).toBe(true);
		inputs.card = null;
		step();
		expect(state.pinned).toBe(false);
		expect(state.center).toBeNull();

		inputs.card = cardOn("parents", "T1");
		state.pin("T1");
		step();
		inputs.card = cardOn("monitors", "monitor:9", [80, 0]);
		step();
		expect(state.pinned).toBe(false);
	});

	it("a pin with no card stays until released", () => {
		const { state } = lens();
		state.pin("T2");
		step(1000);
		expect(state.pinned).toBe(true);
		state.escape();
		step();
		expect(state.pinned).toBe(false);
		expect(state.center).toBeNull();
	});

	it("leaving the zoom range drops and releases", () => {
		const { inputs, state } = lens();
		state.pin("T1");
		step();
		inputs.shown = false;
		step();
		expect(state.center).toBeNull();
		expect(state.pinned).toBe(false);
		inputs.parentHover = hover("parents", "T1");
		step();
		expect(state.center).toBeNull();
	});

	it("the centre leaving the parents' data drops and releases", () => {
		const { inputs, state } = lens();
		state.pin("T1");
		step();
		inputs.keys = new Set(["T2", "T3"]);
		step();
		expect(state.center).toBeNull();
		expect(state.pinned).toBe(false);
	});

	it("teardown clears the timer", () => {
		const inputs = new FakeLensInputs();
		const state = createLensState(inputs);
		const stop = state.start();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.parentHover = null;
		step();
		stop();
		expect(vi.getTimerCount()).toBe(0);
		expect(state.center).toBeNull();
	});

	it("a pinned lens survives a teardown and a new start", () => {
		const inputs = new FakeLensInputs();
		const state = createLensState(inputs);
		const stop = state.start();
		state.pin("T1");
		step();
		stop();
		expect(state.center).toBe("T1");
		expect(state.pinned).toBe(true);
		stops.push(state.start());
		step(1000);
		expect(state.center).toBe("T1");
	});

	it("pin is refused out of range or for an unknown parent", () => {
		const { inputs, state } = lens();
		inputs.shown = false;
		step();
		state.pin("T1");
		step();
		expect(state.center).toBeNull();
		expect(state.pinned).toBe(false);
		inputs.shown = true;
		step();
		state.pin("T9");
		step();
		expect(state.center).toBeNull();
		expect(state.pinned).toBe(false);
	});

	it("pin while a card outside the block is pinned stays pinned through later moves", () => {
		const { inputs, state } = lens();
		inputs.card = cardOn("monitors", "monitor:9", [80, 0]);
		step();
		state.pin("T1");
		step();
		inputs.parentHover = hover("parents", "T2");
		step();
		inputs.parentHover = hover("parents", "T3");
		step();
		expect(state.pinned).toBe(true);
		inputs.card = null;
		step();
		expect(state.pinned).toBe(false);
	});

	it("Esc with the pointer over a neighbour's child keeps the lens down until the hover changes", () => {
		const { inputs, state } = lens();
		state.pin("T1");
		inputs.parentHover = hover("parents", "T2");
		inputs.childHover = hover("lens", "T2-S1");
		step();
		state.escape();
		// The children go, so the pointer is over the neighbour township alone.
		inputs.childHover = null;
		step(1000);
		expect(state.center).toBeNull();
		inputs.parentHover = hover("parents", "T3");
		step();
		expect(state.center).toBe("T3");
	});

	it("a lens released by its card moving to another township follows the hover at once", () => {
		const { inputs, state } = lens();
		inputs.card = cardOn("parents", "T1");
		state.pin("T1");
		step();
		inputs.parentHover = hover("parents", "T3");
		step();
		// The person picks a township outside the block (blockX: inside is x < 10).
		inputs.card = cardOn("parents", "T3", [50, 0]);
		step();
		expect(state.pinned).toBe(false);
		expect(state.center).toBe("T3");
	});

	it("the parents detaching drops and releases the lens", () => {
		const { inputs, state } = lens();
		state.pin("T1");
		step();
		inputs.live = false;
		step();
		expect(state.center).toBeNull();
		expect(state.pinned).toBe(false);
	});

	it("list focus moving the card outside the block keeps a pinned lens; a click there releases it", () => {
		const { inputs, state } = lens();
		inputs.card = cardOn("parents", "T1");
		inputs.focus = "T1";
		state.pin("T1");
		step();
		// Arrowing down the list: the next row is a township outside the block.
		inputs.focus = "T3";
		inputs.card = cardOn("parents", "T3", [50, 0]);
		step();
		expect(state.pinned).toBe(true);
		inputs.focus = "monitor:9";
		inputs.card = cardOn("monitors", "monitor:9", [80, 0]);
		step();
		expect(state.pinned).toBe(true);
		// Leaving the list, then a click on a feature outside the block.
		inputs.focus = null;
		step();
		expect(state.pinned).toBe(true);
		inputs.card = cardOn("monitors", "monitor:8", [90, 0]);
		step();
		expect(state.pinned).toBe(false);
	});
});
