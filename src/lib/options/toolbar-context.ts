import { getContext, setContext } from "svelte";
import type { MapContext } from "../core/create-map.svelte.js";
import type { OptionsMenus } from "./menus.svelte.js";
import type { OptionValues } from "./types.js";
import type { OptionChange } from "./values.js";

/** What an options toolbar shares with its menus and rows. One per toolbar. */
export interface ToolbarContext {
	readonly map: MapContext;
	readonly menus: OptionsMenus;
	/** Per-toolbar id prefix (`$props.id()`). */
	readonly uid: string;
	readonly values: OptionValues;
	readonly defaults: OptionValues | undefined;
	readonly readonly: boolean;
	/** The wide layout (dropdowns) rather than the narrow panel (sections). */
	readonly wide: boolean;
	/** A row's value: the map's basemap for the basemap key, else the host's value. */
	valueOf(id: string): boolean | string | undefined;
	/** Sends one change to the host, unless it changes nothing or the toolbar is read-only. */
	emit(change: OptionChange): void;
}

const KEY = Symbol("mapsdk-options-toolbar");

export function setToolbarContext(ctx: ToolbarContext): void {
	setContext(KEY, ctx);
}

export function getToolbarContext(): ToolbarContext {
	const ctx = getContext<ToolbarContext | undefined>(KEY);
	if (!ctx) throw new Error("map-sdk: option menus and rows must be inside an OptionsToolbar");
	return ctx;
}
