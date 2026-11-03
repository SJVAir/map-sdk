import type { GlMapLike } from "./gl.js";

export interface BasemapConfig {
	styles: Array<{ id: string; style: unknown }>;
	defaultId: string;
	excludedLayers?: string[];
}

/**
 * The map's current basemap. A stub for now: it only stores `current`. Completed in Task 11
 * (style switching with fallback, removing `excludedLayers`, and calling `onStyleReady` after
 * each successful style load).
 */
export class BasemapState {
	#current = $state("");

	constructor(config: BasemapConfig | undefined) {
		this.#current = config?.defaultId ?? "";
	}

	/** The selected basemap id. Reactive. */
	get current(): string {
		return this.#current;
	}

	select(id: string): void {
		this.#current = id;
	}

	attach(gl: GlMapLike, onStyleReady: () => void): void {
		void gl;
		void onStyleReady;
	}

	detach(): void {}
}
