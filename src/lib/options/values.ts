import type { OptionChoice, OptionRow, OptionValues } from "./types.js";

type GroupRow = Extract<OptionRow, { kind: "group" }>;

export type GroupStatus = "checked" | "unchecked" | "indeterminate" | "empty";

/** One user action's outcome: the next values, and the keys that changed (none: no event). */
export interface OptionChange {
	values: OptionValues;
	changed: string[];
}

/** A select-all row's state, from its children's values. */
export function groupStatus(row: GroupRow, values: OptionValues): GroupStatus {
	if (row.children.length === 0) return "empty";
	const on = row.children.filter((child) => values[child.id] === true).length;
	if (on === 0) return "unchecked";
	return on === row.children.length ? "checked" : "indeterminate";
}

/** Sets every child of a select-all row to `on`, as one change. */
export function applyGroup(row: GroupRow, values: OptionValues, on: boolean): OptionChange {
	const next = { ...values };
	const changed: string[] = [];
	for (const child of row.children) {
		if ((values[child.id] === true) === on) continue;
		next[child.id] = on;
		changed.push(child.id);
	}
	return { values: changed.length ? next : values, changed };
}

export function applyValue(
	id: string,
	value: boolean | string,
	values: OptionValues
): OptionChange {
	if (values[id] === value) return { values, changed: [] };
	return { values: { ...values, [id]: value }, changed: [id] };
}

/** Puts `defaults` back over `values`, as one change. Keys `defaults` doesn't name are kept. */
export function applyReset(defaults: OptionValues, values: OptionValues): OptionChange {
	const changed = Object.keys(defaults).filter((key) => values[key] !== defaults[key]);
	return { values: changed.length ? { ...values, ...defaults } : values, changed };
}

/** The choice showing as chosen for `value`: by its value, then by its `matches`. */
export function choiceFor(
	row: { choices: OptionChoice[] },
	value: unknown
): OptionChoice | undefined {
	if (typeof value !== "string") return undefined;
	return (
		row.choices.find((c) => c.value === value) ??
		row.choices.find((c) => c.matches?.includes(value))
	);
}
