import type { BasemapStyle } from "../core/basemap.svelte.js";
import type { MapContext } from "../core/create-map.svelte.js";
import type { MessageKey } from "../data/messages.js";
import type {
	OptionCheckbox,
	OptionIcon,
	OptionRow,
	OptionsPreset,
	OptionValues
} from "./types.js";

export interface BasemapOptionsOptions {
	/** The values key the rows share (default `"basemap"`): the variant id. */
	key?: string;
	icons?: { basemap?: OptionIcon; theme?: OptionIcon };
}

interface Basemap {
	name: string;
	variants: BasemapStyle[];
	defaultVariant: BasemapStyle;
}

/** The map's styles grouped by basemap, in their order; an unnamed style is a basemap of its own. */
function basemapsOf(map: MapContext): Basemap[] {
	const byName = new Map<string, BasemapStyle[]>();
	for (const style of map.basemap.styles) {
		const name = style.basemap ?? style.id;
		const list = byName.get(name);
		if (list) list.push(style);
		else byName.set(name, [style]);
	}
	return Array.from(byName, ([name, variants]) => ({
		name,
		variants,
		defaultVariant: variants.find((v) => v.isDefault) ?? variants[0]
	}));
}

/**
 * The Basemap select (one choice per basemap: its default variant, also chosen for its other
 * variants) and the Theme radios (the current basemap's variants), both on one key holding the
 * variant id. Each is left out when it has one choice. They read `map.basemap.current`, so build
 * them in a `$derived` and pass the key to `OptionsToolbar`'s `basemapKey`; the host applies a
 * change with `map.basemap.select(values[key])`.
 */
export function basemapOptions(
	map: MapContext,
	options: BasemapOptionsOptions = {}
): { rows: OptionRow[]; key: string; defaults: OptionValues } {
	const key = options.key ?? "basemap";
	const basemaps = basemapsOf(map);
	const current = map.basemap.current;
	const shown = basemaps.find((b) => b.variants.some((v) => v.id === current));
	const rows: OptionRow[] = [];
	if (basemaps.length > 1) {
		rows.push({
			kind: "select",
			id: key,
			label: map.messages("mapsdk_options_basemap"),
			...(options.icons?.basemap && { icon: options.icons.basemap }),
			choices: basemaps.map((b) => ({
				value: b.defaultVariant.id,
				label: b.name,
				matches: b.variants.filter((v) => v !== b.defaultVariant).map((v) => v.id)
			}))
		});
	}
	if (shown && shown.variants.length > 1) {
		rows.push({
			kind: "radio",
			id: key,
			label: map.messages("mapsdk_options_theme"),
			...(options.icons?.theme && { icon: options.icons.theme }),
			choices: shown.variants.map((v) => ({ value: v.id, label: v.name ?? v.id }))
		});
	}
	return { rows, key, defaults: { [key]: map.basemap.defaultId } };
}

export interface SettingsGroupOptions {
	icon?: OptionIcon;
	/** Joins the other groups with this `cluster` (default `"options"`). */
	cluster?: string;
	/** Monitor-map's Marker Clusters row (default key `"clustered"`, on); `false` leaves it out. */
	clusters?: { key?: string; icon?: OptionIcon } | false;
	/** The basemap rows; `false` leaves them out. */
	basemap?: BasemapOptionsOptions | false;
	/** The Reset Map Options row; `false` leaves it out. */
	reset?: { icon?: OptionIcon } | false;
}

/** Monitor-map's Settings group: Marker Clusters, the basemap rows, and Reset Map Options. */
export function settingsGroup(map: MapContext, options: SettingsGroupOptions = {}): OptionsPreset {
	const sections: OptionRow[][] = [];
	const defaults: OptionValues = {};
	if (options.clusters !== false) {
		const key = options.clusters?.key ?? "clustered";
		const row: OptionCheckbox = {
			kind: "checkbox",
			id: key,
			label: map.messages("mapsdk_options_marker_clusters")
		};
		if (options.clusters?.icon) row.icon = options.clusters.icon;
		sections.push([row]);
		defaults[key] = true;
	}
	if (options.basemap !== false) {
		const basemap = basemapOptions(map, options.basemap || {});
		if (basemap.rows.length) sections.push(basemap.rows);
		Object.assign(defaults, basemap.defaults);
	}
	if (options.reset !== false) {
		sections.push([
			{
				kind: "reset",
				id: "reset",
				label: map.messages("mapsdk_options_reset"),
				...(options.reset?.icon && { icon: options.reset.icon })
			}
		]);
	}
	const rows = sections.flatMap((section, i) =>
		i === 0 ? section : [{ kind: "separator" as const, id: `separator-${i}` }, ...section]
	);
	return {
		groups: [
			{
				id: "settings",
				label: map.messages("mapsdk_options_settings"),
				...(options.icon && { icon: options.icon }),
				iconOnly: true,
				align: "end",
				cluster: options.cluster ?? "options",
				rows
			}
		],
		defaults
	};
}

function toggleRow(
	map: MapContext,
	message: MessageKey,
	key: string,
	icon: OptionIcon | undefined
): { row: OptionCheckbox; defaults: OptionValues } {
	const row: OptionCheckbox = { kind: "checkbox", id: key, label: map.messages(message) };
	if (icon) row.icon = icon;
	return { row, defaults: { [key]: true } };
}

/** Monitor-map's Fire & Smoke row (default key `"fireAndSmoke"`, on): one row for both HMS plugins. */
export function hmsOptions(
	map: MapContext,
	options: { key?: string; icon?: OptionIcon } = {}
): { row: OptionCheckbox; defaults: OptionValues } {
	return toggleRow(map, "mapsdk_options_fire_smoke", options.key ?? "fireAndSmoke", options.icon);
}

/** A Schools & Child Care row (default key `"schools"`, on), for `schoolsPlugin`. */
export function schoolsOptions(
	map: MapContext,
	options: { key?: string; icon?: OptionIcon } = {}
): { row: OptionCheckbox; defaults: OptionValues } {
	return toggleRow(map, "mapsdk_options_schools", options.key ?? "schools", options.icon);
}
