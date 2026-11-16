import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { createLensState } from "../../../src/lib/plugins/lens-state.svelte.js";
import { FakeLensInputs, hover } from "../../fixtures/lens-inputs.svelte.js";

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
		inputs.card = hover("parents", "T1");
		step();
		expect(state.pinned).toBe(false);
		inputs.parentHover = hover("parents", "T2");
		step();
		expect(state.center).toBe("T2");
		inputs.card = hover("lens", "T2-S3");
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

	it("a notice card inside the block holds the lens; one outside doesn't", () => {
		const { inputs, state } = lens();
		inputs.parentHover = hover("parents", "T1");
		step();
		inputs.card = hover("notices", "feature:n1", false, [1, 1]);
		step();
		expect(state.held).toBe(true);
		inputs.card = hover("notices", "feature:n2", false, [50, 1]);
		step();
		expect(state.held).toBe(false);
	});

	it("a pinned lens is released when the pinned card closes or moves outside the block", () => {
		const { inputs, state } = lens();
		inputs.card = hover("parents", "T1");
		state.pin("T1");
		step();
		inputs.card = hover("lens", "T1-S2");
		step();
		expect(state.pinned).toBe(true);
		inputs.card = null;
		step();
		expect(state.pinned).toBe(false);
		expect(state.center).toBeNull();

		inputs.card = hover("parents", "T1");
		state.pin("T1");
		step();
		inputs.card = hover("monitors", "monitor:9", false, [80, 0]);
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
});
