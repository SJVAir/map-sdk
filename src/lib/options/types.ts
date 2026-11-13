import type { Snippet } from "svelte";

/** An options toolbar's values, keyed by row id. The host owns them. */
export type OptionValues = Record<string, boolean | string>;

/** A row's or group's icon: a snippet (a Lucide icon, tinted by the host), or SVG markup such as `circle(...)`. */
export type OptionIcon = Snippet | { svg: string };

export interface OptionChoice {
	value: string;
	label: string;
	/** Shown in small text after the label ("µg/m³"). */
	unit?: string;
	/** A line under the label. */
	help?: string;
	icon?: OptionIcon;
	/** Other values this choice also shows as chosen (a basemap for each of its variants). */
	matches?: string[];
}

export interface OptionCheckbox {
	kind: "checkbox";
	id: string;
	label: string;
	icon?: OptionIcon;
	/** Rows shown under it while it's on. */
	children?: OptionRow[];
}

export type OptionRow =
	| OptionCheckbox
	/** A select-all over `children`: checked, unchecked, or partly checked from them; no value of its own. Hidden with no children. */
	| { kind: "group"; id: string; label: string; icon?: OptionIcon; children: OptionCheckbox[] }
	/** Radios for one key; `label` heads them. `closesMenu`: picking one closes the wide dropdown. */
	| {
			kind: "radio";
			id: string;
			label?: string;
			icon?: OptionIcon;
			choices: OptionChoice[];
			closesMenu?: boolean;
	  }
	| { kind: "select"; id: string; label: string; icon?: OptionIcon; choices: OptionChoice[] }
	/** The host's own button. */
	| { kind: "action"; id: string; label: string; icon?: OptionIcon; onclick: () => void }
	/** Puts the toolbar's `defaults` back, as one change. Not shown without `defaults`. */
	| { kind: "reset"; id: string; label: string; icon?: OptionIcon }
	| { kind: "separator"; id: string };

export interface OptionGroup {
	id: string;
	label: string;
	icon?: OptionIcon;
	/** The wide toolbar shows the icon alone; the narrow panel still shows the label. */
	iconOnly?: boolean;
	/** `"end"` anchors the wide dropdown to the trigger's right edge. */
	align?: "start" | "end";
	disabled?: boolean;
	/** Groups with the same `cluster` join into one button row, in order. */
	cluster?: string;
	rows: OptionRow[];
}

/** What an options preset gives the host: its groups and their starting values. */
export interface OptionsPreset {
	groups: OptionGroup[];
	defaults: OptionValues;
}
