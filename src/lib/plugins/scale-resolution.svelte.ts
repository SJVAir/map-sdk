import { untrack } from "svelte";
import type { LegendData, PluginContext } from "../core/plugin.js";
import type { Scale, ScaleRef } from "../data/scale-types.js";
import type { DataSource, DataStatus, MapFeatureProperties } from "../data/types.js";

/** For a `null` source scale: features still draw, all neutral, with no legend. */
export const NO_SCALE: Scale = { id: "", label: "", units: "", kind: "category", levels: [] };

type ScaleInput = ScaleRef | Scale | null;
export type Resolved = Scale | "unavailable";

/** Equal for scales equal by value. */
export function scaleKey(scale: Scale): string {
	return JSON.stringify(scale);
}

function isScale(input: ScaleInput): input is Scale {
	return input !== null && "levels" in input;
}

/** The scale for `input` when it is available synchronously. */
function immediate(input: ScaleInput): Resolved | null {
	if (input === null) return NO_SCALE;
	return isScale(input) ? input : null;
}

export interface ScaleResolver {
	/** The scale for the source's current input, or null while it resolves. */
	current(): Resolved | null;
	/** The legend entry for the source's status and scale. */
	legend(): LegendData | null;
	/** Resolves a `ScaleRef` through the metadata provider whenever the input changes. */
	track(ctx: PluginContext, isDead: () => boolean): void;
}

/** Scale resolution shared by the plugins: abort on change, ignore late results. */
export function createScaleResolver<P extends MapFeatureProperties>(
	pluginId: string,
	layerLabel: string,
	source: DataSource<P>
): ScaleResolver {
	/** The scale resolved for a source scale input, from the latest setup. */
	let resolution = $state.raw<{ input: ScaleInput; scale: Resolved } | null>(null);

	function current(): Resolved | null {
		const input = source.scale;
		const now = immediate(input);
		if (now) return now;
		return resolution?.input === input ? resolution.scale : null;
	}

	function legend(): LegendData | null {
		const status = source.status;
		if (status.state === "error" || status.state === "unavailable") {
			return { pluginId, status };
		}
		const scale = current();
		if (scale === null) return { pluginId, status: { state: "loading" } };
		if (scale === "unavailable") {
			const unavailable: DataStatus = { state: "unavailable", reason: "scale" };
			return { pluginId, status: unavailable };
		}
		if (scale === NO_SCALE) return null;
		return { pluginId, title: layerLabel, units: scale.units, scale };
	}

	function track(ctx: PluginContext, isDead: () => boolean): void {
		ctx.effect(() => {
			const input = source.scale;
			if (input === null || isScale(input)) return;
			// Already resolved by an earlier setup; an "unavailable" result is retried.
			const known = untrack(() => resolution);
			if (known?.input === input && known.scale !== "unavailable") return;
			const controller = new AbortController();
			ctx.metadata.scale(input, controller.signal).then(
				(scale) => {
					if (!isDead() && !controller.signal.aborted) resolution = { input, scale };
				},
				(error: unknown) => {
					if (isDead() || controller.signal.aborted) return;
					console.warn(`map-sdk: plugin "${pluginId}" could not resolve its scale`, error);
					resolution = { input, scale: "unavailable" };
				}
			);
			return () => controller.abort();
		});
	}

	return { current, legend, track };
}
