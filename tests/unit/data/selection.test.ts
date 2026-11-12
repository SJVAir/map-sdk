import { describe, expect, it } from "vitest";
import {
	applyPick,
	selectionKeys,
	selectionKind,
	toggleInSelection
} from "../../../src/lib/data/selection.js";
import type { FeatureRef, SpatialSelection } from "../../../src/lib/data/types.js";

const mon = (id: string): FeatureRef => ({ kind: "monitor", id });
const monitors = (...ids: string[]): SpatialSelection => ({ kind: "monitors", ids });
const plain = { additive: false };
const add = { additive: true };

describe("applyPick", () => {
	it("returns current unchanged in mode none", () => {
		const cur = monitors("a");
		expect(applyPick(cur, mon("b"), "none", plain)).toBe(cur);
		expect(applyPick(null, mon("b"), "none", add)).toBeNull();
	});

	it("ignores feature refs in every mode", () => {
		const cur = monitors("a");
		const ref: FeatureRef = { kind: "feature", id: "fire1" };
		for (const mode of ["none", "single", "multiple"] as const) {
			expect(applyPick(cur, ref, mode, add)).toBe(cur);
		}
	});

	it("replaces in single mode, even when additive", () => {
		expect(applyPick(monitors("a"), mon("b"), "single", plain)).toEqual(monitors("b"));
		expect(applyPick(monitors("a"), mon("b"), "single", add)).toEqual(monitors("b"));
	});

	it("replaces with the picked id in multiple mode when not additive", () => {
		expect(applyPick(monitors("a", "c"), mon("b"), "multiple", plain)).toEqual(monitors("b"));
	});

	it("toggles in multiple mode when additive", () => {
		expect(applyPick(monitors("a"), mon("b"), "multiple", add)).toEqual(monitors("a", "b"));
		expect(applyPick(monitors("a", "b"), mon("a"), "multiple", add)).toEqual(monitors("b"));
		expect(applyPick(monitors("a"), mon("a"), "multiple", add)).toBeNull();
		expect(applyPick(null, mon("a"), "multiple", add)).toEqual(monitors("a"));
	});

	it("replaces a monitor selection when a region is picked", () => {
		const region: FeatureRef = { kind: "region", type: "county", code: "06019" };
		expect(applyPick(monitors("a"), region, "multiple", add)).toEqual({
			kind: "regions",
			ids: ["county:06019"]
		});
	});

	it("keeps ids that are not in any data", () => {
		expect(applyPick(monitors("ghost", "a"), mon("b"), "multiple", add)).toEqual(
			monitors("ghost", "a", "b")
		);
	});

	it("does not mutate the current selection", () => {
		const cur = monitors("a");
		applyPick(cur, mon("b"), "multiple", add);
		expect(cur.ids).toEqual(["a"]);
	});
});

describe("selectionKeys", () => {
	it("maps monitors and regions to ref keys", () => {
		expect(selectionKeys(monitors("x"))).toEqual(new Set(["monitor:x"]));
		expect(selectionKeys({ kind: "regions", ids: ["county:06019"] })).toEqual(
			new Set(["region:county:06019"])
		);
		expect(selectionKeys(null)).toEqual(new Set());
	});
});

describe("selectionKind", () => {
	it("classifies refs", () => {
		expect(selectionKind(mon("a"))).toBe("monitors");
		expect(selectionKind({ kind: "region", type: "t", code: "c" })).toBe("regions");
		expect(selectionKind({ kind: "feature", id: "f" })).toBeNull();
	});
});

describe("toggleInSelection", () => {
	const region = (code: string): FeatureRef => ({ kind: "region", type: "county", code });

	it("returns current unchanged in mode none", () => {
		const cur = monitors("a");
		expect(toggleInSelection(cur, mon("b"), "none")).toBe(cur);
	});

	it("leaves the selection unchanged for a feature ref", () => {
		const cur = monitors("a");
		expect(toggleInSelection(cur, { kind: "feature", id: "x" }, "multiple")).toBe(cur);
	});

	it("single: selects, then clears the same one, and replaces with another", () => {
		expect(toggleInSelection(null, mon("a"), "single")).toEqual(monitors("a"));
		expect(toggleInSelection(monitors("a"), mon("a"), "single")).toBeNull();
		expect(toggleInSelection(monitors("a"), mon("b"), "single")).toEqual(monitors("b"));
	});

	it("multiple: adds, removes, and clears on the last", () => {
		expect(toggleInSelection(monitors("a"), mon("b"), "multiple")).toEqual(monitors("a", "b"));
		expect(toggleInSelection(monitors("a", "b"), mon("a"), "multiple")).toEqual(monitors("b"));
		expect(toggleInSelection(monitors("a"), mon("a"), "multiple")).toBeNull();
	});

	it("multiple: another kind starts a new selection", () => {
		const next = toggleInSelection(monitors("a"), region("019"), "multiple");
		expect(next?.kind).toBe("regions");
		expect(next?.ids).toHaveLength(1);
	});
});
