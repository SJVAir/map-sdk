import { getContext, setContext } from "svelte";
import type { MapContext } from "./create-map.svelte.js";

const KEY = Symbol("map-sdk:map");

/** Provides `ctx` to this component's descendants (MapView does this). */
export function setMapContext(ctx: MapContext): void {
	setContext(KEY, ctx);
}

/** The nearest `MapView`'s map. Throws outside one. */
export function getMapContext(): MapContext {
	const ctx = getContext<MapContext | undefined>(KEY);
	if (!ctx) throw new Error("map-sdk: no map context; use this inside a MapView");
	return ctx;
}
