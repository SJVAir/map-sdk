import { describe, expect, it } from "vitest";
import type { OptionRow, OptionValues } from "../../../src/lib/options/types.js";
import {
	applyGroup,
	applyReset,
	applyValue,
	choiceFor,
	groupStatus
} from "../../../src/lib/options/values.js";

type GroupRow = Extract<OptionRow, { kind: "group" }>;

const group: GroupRow = {
	kind: "group",
	id: "low-cost",
	label: "Low-cost sensors",
	children: [
		{ kind: "checkbox", id: "type:purpleair", label: "PurpleAir" },
		{ kind: "checkbox", id: "type:airgradient", label: "AirGradient" }
	]
};

describe("groupStatus", () => {
	it("is checked when every child is on", () => {
		expect(groupStatus(group, { "type:purpleair": true, "type:airgradient": true })).toBe(
			"checked"
		);
	});

	it("is unchecked when every child is off or unset", () => {
		expect(groupStatus(group, { "type:purpleair": false })).toBe("unchecked");
	});

	it("is indeterminate when the children differ", () => {
		expect(groupStatus(group, { "type:purpleair": true, "type:airgradient": false })).toBe(
			"indeterminate"
		);
	});

	it("is empty with no children", () => {
		expect(groupStatus({ ...group, children: [] }, {})).toBe("empty");
	});
});

describe("applyGroup", () => {
	it("sets only the listed children, and names only those that flipped", () => {
		const values: OptionValues = {
			"type:purpleair": true,
			"type:airgradient": false,
			"type:airnow": false,
			clustered: true
		};
		const result = applyGroup(group, values, true);
		expect(result.values).toEqual({
			"type:purpleair": true,
			"type:airgradient": true,
			"type:airnow": false,
			clustered: true
		});
		expect(result.changed).toEqual(["type:airgradient"]);
		expect(values["type:airgradient"]).toBe(false);
	});

	it("turning a checked group off clears every child", () => {
		const result = applyGroup(group, { "type:purpleair": true, "type:airgradient": true }, false);
		expect(result.changed).toEqual(["type:purpleair", "type:airgradient"]);
	});
});

describe("applyValue", () => {
	it("changes one key", () => {
		const values: OptionValues = { pollutant: "pm25", clustered: true };
		const result = applyValue("pollutant", "o3", values);
		expect(result).toEqual({
			values: { pollutant: "o3", clustered: true },
			changed: ["pollutant"]
		});
		expect(result.values).not.toBe(values);
		expect(values.pollutant).toBe("pm25");
	});

	it("an equal value changes nothing", () => {
		expect(applyValue("pollutant", "pm25", { pollutant: "pm25" }).changed).toEqual([]);
	});
});

describe("applyReset", () => {
	it("puts the defaults over the values, keeping keys the defaults don't name", () => {
		const result = applyReset(
			{ pollutant: "pm25", clustered: true },
			{ pollutant: "o3", clustered: true, extra: false }
		);
		expect(result.values).toEqual({ pollutant: "pm25", clustered: true, extra: false });
		expect(result.changed).toEqual(["pollutant"]);
	});

	it("at the defaults already, changes nothing", () => {
		expect(applyReset({ a: true }, { a: true }).changed).toEqual([]);
	});
});

describe("choiceFor", () => {
	const row = {
		choices: [
			{ value: "streets-v4", label: "Streets", matches: ["streets-v4-dark"] },
			{ value: "outdoor-v4", label: "Outdoor" }
		]
	};

	it("finds a choice by value, then by matches", () => {
		expect(choiceFor(row, "outdoor-v4")?.label).toBe("Outdoor");
		expect(choiceFor(row, "streets-v4-dark")?.label).toBe("Streets");
		expect(choiceFor(row, "nope")).toBeUndefined();
	});
});
