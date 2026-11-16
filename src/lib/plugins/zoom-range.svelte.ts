import type { GlMapLike } from "../core/gl.js";
import type { LayerSpecWithoutId } from "../core/plugin.js";

/** Visible from `min` (inclusive) up to `max` (exclusive) of the camera zoom. */
export interface ZoomRange {
	min?: number;
	max?: number;
}

/**
 * A plugin's zoom range: shows and hides its layers by the camera zoom, not with layer
 * minzoom/maxzoom. On a globe MapLibre uses the next zoom's tiles a little before the camera gets
 * there and leaves a layer out of tiles at or above its maxzoom, so two plugins whose ranges meet
 * (fire groups below 10, hotspots from 10) would leave a gap where neither drew.
 */
export function zoomRanged(range: ZoomRange | undefined) {
	const { min, max } = range ?? {};
	const ranged = min !== undefined || max !== undefined;
	const inRange = (zoom: number) =>
		(min === undefined || zoom >= min) && (max === undefined || zoom < max);
	let shown = $state(true);

	return {
		ranged,
		/** Reactive: the camera zoom is inside the range (always true when not ranged). */
		get shown(): boolean {
			return shown;
		},
		/** The spec with `layout.visibility` from `shown`; unchanged when not ranged. */
		zoomed(spec: LayerSpecWithoutId): LayerSpecWithoutId {
			if (!ranged) return spec;
			const layout = (spec as { layout?: Record<string, unknown> }).layout;
			return {
				...spec,
				layout: { ...layout, visibility: shown ? "visible" : "none" }
			} as LayerSpecWithoutId;
		},
		/**
		 * Reads the zoom now and follows it, setting visibility on `layerIds()` when it crosses the
		 * range. Returns the teardown, which stops following and leaves `shown` true. Nothing when
		 * not ranged.
		 */
		track(gl: GlMapLike, layerIds: () => string[], isDead: () => boolean): () => void {
			if (!ranged) return () => {};
			shown = inRange(gl.getZoom());
			const onZoom = () => {
				if (isDead() || inRange(gl.getZoom()) === shown) return;
				shown = !shown;
				for (const layerId of layerIds()) {
					if (gl.getLayer(layerId)) {
						gl.setLayoutProperty(layerId, "visibility", shown ? "visible" : "none");
					}
				}
			};
			gl.on("zoom", onZoom);
			return () => {
				gl.off("zoom", onZoom);
				shown = true;
			};
		}
	};
}
