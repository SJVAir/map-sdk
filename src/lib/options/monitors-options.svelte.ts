import { SvelteMap } from "svelte/reactivity";
import type { MapContext } from "../core/create-map.svelte.js";
import type { MonitorGroup } from "../data/metadata.js";
import { circle, triangle } from "../plugins/icons.js";
import { monitorShape } from "../presets/monitors.js";
import type {
	OptionCheckbox,
	OptionChoice,
	OptionGroup,
	OptionIcon,
	OptionRow,
	OptionsPreset,
	OptionValues
} from "./types.js";

const AIR_QUALITY = "air-quality";
/** monitor-map's marker colors for the rows (the fixed-color exceptions for inactive and inside). */
const DISPLAY_COLOR = "#48c78e";
const INACTIVE_COLOR = "#969696";
const INSIDE_OUTLINE = "#000000";
const BORDER_WIDTH = 2;
/** The group whose marker is a triangle; every other group's is a circle. */
const REFERENCE_GROUP = "reference";

export interface MonitorsOptionsInput {
	/** The tile's monitor types (its data), in display order. */
	types: string[];
	/** The tile's pollutants (a subset of the metadata's `available_pollutants`), in order. */
	pollutants: string[];
	/** The chosen pollutant (null: "None"). Types that don't report it are left out. */
	pollutant: string | null;
	/** What Reset puts back for the pollutant (default: the first of `pollutants`). */
	defaultPollutant?: string;
	/** The loaded monitors include inactive ones: adds the Inactive row. */
	hasInactive?: boolean;
	/** The loaded monitors include inside ones: adds the Inside row. */
	hasInside?: boolean;
	/** monitor-map's Collocation Sites row (shown for PM2.5 only). */
	collocation?: boolean;
	/** monitor-map's "None" choice; while it's chosen the Monitors group is disabled. */
	none?: boolean;
	/** Host icons (Lucide snippets, or the pollutants' artwork); the marker icons are map-sdk's. */
	icons?: {
		monitors?: OptionIcon;
		pollutant?: Record<string, OptionIcon>;
		none?: OptionIcon;
		collocation?: OptionIcon;
	};
	/** Values keys (defaults: `pollutant`, `type:<type>`, `inactive`, `inside`, `collocationSites`). */
	keys?: {
		pollutant?: string;
		type?: (type: string) => string;
		inactive?: string;
		inside?: string;
		collocation?: string;
	};
	/** Joins the other groups with this `cluster` (default `"options"`). */
	cluster?: string;
}

export interface MonitorsOptions {
	/**
	 * The Pollutant group (when there are two or more choices) and the Monitors group, with their
	 * defaults. Reads labels the map's metadata provider resolves into state, so call it in a
	 * `$derived`: it re-runs as they arrive.
	 */
	groups(input: MonitorsOptionsInput): OptionsPreset;
}

const svgIcon = (svg: string): OptionIcon => ({ svg });
const markerFor = (shape: "triangle" | "circle"): OptionIcon =>
	svgIcon(
		shape === "triangle"
			? triangle(DISPLAY_COLOR, BORDER_WIDTH)
			: circle(DISPLAY_COLOR, BORDER_WIDTH)
	);

type Answer<T> = T | "unavailable";

/**
 * Monitor-map's Pollutant and Monitors groups for one map, from the tile's types and pollutants
 * and the map's `MetadataProvider` (labels, units, help text, groups, which types report which
 * pollutant). Never fetches anything itself; the provider does.
 */
export function monitorsOptions(map: MapContext): MonitorsOptions {
	const metadata = map.metadata;
	// Per map, filled as the provider answers. Writes happen after a fetch resolves, never while
	// a $derived is reading.
	let groupList = $state<Answer<MonitorGroup[]> | undefined>(undefined);
	const typeLabels = new SvelteMap<string, Answer<string>>();
	const typeGroups = new SvelteMap<string, Answer<string>>();
	const reports = new SvelteMap<string, Answer<boolean>>();
	const entries = new SvelteMap<string, Answer<{ label: string; units: string }>>();
	const helps = new SvelteMap<string, Answer<string>>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
	const asked = new Set<string>();

	/** Starts `fetch` once per `key`, outside the reader's tracking, storing its answer with `store`. */
	function ask<T>(key: string, fetch: () => Promise<T> | undefined, store: (v: T) => void) {
		if (asked.has(key)) return;
		asked.add(key);
		queueMicrotask(() => {
			const p = fetch();
			if (!p) return;
			p.then(store, () => asked.delete(key));
		});
	}

	function typeLabel(type: string): string {
		ask(
			`label:${type}`,
			() => metadata.monitorTypeLabel(type),
			(v) => typeLabels.set(type, v)
		);
		const v = typeLabels.get(type);
		return v && v !== "unavailable" ? v : type;
	}

	function typeGroup(type: string): string | null {
		ask(
			`group:${type}`,
			() => metadata.monitorTypeGroup?.(type),
			(v) => typeGroups.set(type, v)
		);
		const v = typeGroups.get(type);
		return v && v !== "unavailable" ? v : null;
	}

	/** False only when the metadata says so; unknown counts as reporting. */
	function typeReports(type: string, pollutant: string): boolean {
		const key = `${type}|${pollutant}`;
		ask(
			`reports:${key}`,
			() => metadata.monitorTypeReports?.(type, pollutant),
			(v) => reports.set(key, v)
		);
		return reports.get(key) !== false;
	}

	function entry(pollutant: string): { label: string; units?: string; help?: string } {
		ask(
			`entry:${pollutant}`,
			() => metadata.entryType({ dataset: AIR_QUALITY, entryType: pollutant }),
			(v) => entries.set(pollutant, v === "unavailable" ? v : { label: v.label, units: v.units })
		);
		ask(
			`help:${pollutant}`,
			() => metadata.entryTypeHelp?.({ dataset: AIR_QUALITY, entryType: pollutant }),
			(v) => helps.set(pollutant, v)
		);
		const info = entries.get(pollutant);
		const help = helps.get(pollutant);
		return {
			label: info && info !== "unavailable" ? info.label : pollutant,
			...(info && info !== "unavailable" && info.units && { units: info.units }),
			...(help && help !== "unavailable" && { help })
		};
	}

	function groupsKnown(): MonitorGroup[] {
		ask(
			"groups",
			() => metadata.monitorGroups?.(),
			(v) => (groupList = v)
		);
		return Array.isArray(groupList) ? groupList : [];
	}

	return {
		groups(input) {
			const k = {
				pollutant: input.keys?.pollutant ?? "pollutant",
				type: input.keys?.type ?? ((type: string) => `type:${type}`),
				inactive: input.keys?.inactive ?? "inactive",
				inside: input.keys?.inside ?? "inside",
				collocation: input.keys?.collocation ?? "collocationSites"
			};
			const cluster = input.cluster ?? "options";
			const groups: OptionGroup[] = [];
			const defaults: OptionValues = {};

			// Pollutant: the tile's pollutants (and None), its trigger following the choice.
			const choices: OptionChoice[] = input.pollutants.map((p) => {
				const info = entry(p);
				const icon = input.icons?.pollutant?.[p];
				return {
					value: p,
					label: info.label,
					...(info.units && { unit: info.units }),
					...(info.help && { help: info.help }),
					...(icon && { icon })
				};
			});
			if (input.none) {
				choices.push({
					value: "none",
					label: map.messages("mapsdk_options_none"),
					...(input.icons?.none && { icon: input.icons.none })
				});
			}
			const chosen = choices.find((c) => c.value === (input.pollutant ?? "none")) ?? choices[0];
			if (choices.length > 1 && chosen) {
				groups.push({
					id: "pollutant",
					label: chosen.label,
					...(chosen.icon && { icon: chosen.icon }),
					rows: [{ kind: "radio", id: k.pollutant, closesMenu: true, choices }]
				});
			}
			defaults[k.pollutant] = input.defaultPollutant ?? input.pollutants[0] ?? "none";

			// Monitors: the tile's types that report the pollutant, grouped when they span two groups.
			const shown = input.pollutant
				? input.types.filter((t) => typeReports(t, input.pollutant!))
				: input.types;
			const known = groupsKnown();
			const keyOf = (type: string) => {
				const key = typeGroup(type);
				return key && known.some((g) => g.key === key) ? key : null;
			};
			const markerOf = (type: string) => {
				const key = keyOf(type);
				if (key) return markerFor(key === REFERENCE_GROUP ? "triangle" : "circle");
				return markerFor(monitorShape(type) === "triangle" ? "triangle" : "circle");
			};
			const typeRow = (type: string, icon?: OptionIcon): OptionCheckbox => ({
				kind: "checkbox",
				id: k.type(type),
				label: typeLabel(type),
				...(icon && { icon })
			});
			const present = known.filter((g) => shown.some((t) => keyOf(t) === g.key));
			const rows: OptionRow[] = [];
			if (present.length >= 2) {
				for (const g of present) {
					rows.push({
						kind: "group",
						id: `group:${g.key}`,
						label: g.label,
						icon: markerFor(g.key === REFERENCE_GROUP ? "triangle" : "circle"),
						children: shown.filter((t) => keyOf(t) === g.key).map((t) => typeRow(t))
					});
				}
				for (const t of shown.filter((t) => keyOf(t) === null)) rows.push(typeRow(t, markerOf(t)));
			} else {
				for (const t of shown) rows.push(typeRow(t, markerOf(t)));
			}
			for (const t of input.types) defaults[k.type(t)] = true;

			const extras: OptionRow[] = [];
			if (input.hasInactive) {
				extras.push({
					kind: "checkbox",
					id: k.inactive,
					label: map.messages("mapsdk_options_inactive"),
					icon: svgIcon(circle(INACTIVE_COLOR, BORDER_WIDTH))
				});
				defaults[k.inactive] = false;
			}
			if (input.hasInside) {
				extras.push({
					kind: "checkbox",
					id: k.inside,
					label: map.messages("mapsdk_options_inside"),
					icon: svgIcon(circle(DISPLAY_COLOR, BORDER_WIDTH, INSIDE_OUTLINE))
				});
				defaults[k.inside] = false;
			}
			if (input.collocation) {
				defaults[k.collocation] = false;
				if (input.pollutant === "pm25") {
					extras.push({
						kind: "checkbox",
						id: k.collocation,
						label: map.messages("mapsdk_options_collocation_sites"),
						...(input.icons?.collocation && { icon: input.icons.collocation })
					});
				}
			}
			if (extras.length) rows.push({ kind: "separator", id: "monitors-extras" }, ...extras);

			groups.push({
				id: "monitors",
				label: map.messages("mapsdk_options_monitors"),
				...(input.icons?.monitors && { icon: input.icons.monitors }),
				cluster,
				disabled: Boolean(input.none && input.pollutant === null),
				rows
			});
			return { groups, defaults };
		}
	};
}
