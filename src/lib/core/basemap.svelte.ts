import { untrack } from "svelte";
import type { GlMapLike } from "./gl.js";

export interface BasemapConfig {
	styles: Array<{ id: string; style: unknown }>;
	defaultId: string;
	excludedLayers?: string[];
}

/** The first of these means the style of a map just created is ready. */
const STYLE_READY_EVENTS = ["style.load", "idle"] as const;

/**
 * The map's current basemap, and switching it on a GL map.
 *
 * The GL map is created with the style of `current` (the map's creator does that), so `attach`
 * calls `setStyle` for nothing. Later `select` calls load the new style. A newer `select`
 * supersedes one still loading. If the style document fails, the map goes back to the last style
 * that loaded and `current` reverts; if that fails too, the map stays unstyled until the next
 * `select`. After each successful `select` load, `excludedLayers` are removed and `onStyleReady`
 * is called (it re-runs the plugins). The map's first style is not announced: the plugin host
 * already waits for it.
 */
export class BasemapState {
	#current = $state("");
	#config: BasemapConfig | undefined;
	#gl: GlMapLike | null = null;
	#onStyleReady: (() => void) | null = null;
	/** The id last handed to `setStyle` (loaded or loading); null once a load failed with no fallback. */
	#applied: string | null = null;
	/** The id the map last finished loading, which a failed change falls back to. */
	#loaded = "";
	#stopWaiting: (() => void) | null = null;

	constructor(config: BasemapConfig | undefined) {
		this.#config = config;
		this.#current = config?.defaultId ?? "";
	}

	/** The selected basemap id. Reactive. */
	get current(): string {
		return this.#current;
	}

	/** Unknown ids are ignored. While no map is attached, only `current` changes. */
	select(id: string): void {
		if (!this.#entry(id)) return;
		this.#current = id;
		if (!this.#gl || id === this.#applied) return;
		this.#load(id);
	}

	/**
	 * Uses `gl` from now on, which must already show (or be loading) the style of `current`.
	 * Reads `current` untracked, so calling this in an effect doesn't make it depend on it.
	 */
	attach(gl: GlMapLike, onStyleReady: () => void): void {
		if (this.#gl === gl) return;
		if (this.#gl) this.detach();
		this.#gl = gl;
		this.#onStyleReady = onStyleReady;
		const id = untrack(() => this.#current);
		this.#applied = id;
		this.#loaded = id;
		// The first style: drop the excluded layers, but leave the plugin host to set itself up.
		this.#whenReady(gl, () => this.#removeExcluded(gl));
	}

	detach(): void {
		this.#stopWaiting?.();
		this.#gl = null;
		this.#onStyleReady = null;
	}

	#entry(id: string) {
		return this.#config?.styles.find((s) => s.id === id);
	}

	/** Runs `fn` once `gl`'s style is ready, at once if it is. Cancelled by `#stopWaiting`. */
	#whenReady(gl: GlMapLike, fn: () => void): void {
		this.#stopWaiting?.();
		if (gl.isStyleLoaded()) {
			fn();
			return;
		}
		const listener = () => {
			stop();
			fn();
		};
		const stop = () => {
			for (const type of STYLE_READY_EVENTS) gl.off(type, listener);
			if (this.#stopWaiting === stop) this.#stopWaiting = null;
		};
		this.#stopWaiting = stop;
		for (const type of STYLE_READY_EVENTS) gl.on(type, listener);
	}

	#removeExcluded(gl: GlMapLike): void {
		for (const layerId of this.#config?.excludedLayers ?? []) {
			try {
				if (gl.getLayer(layerId)) gl.removeLayer(layerId);
			} catch (error) {
				console.error(`map-sdk: removing basemap layer "${layerId}" failed`, error);
			}
		}
	}

	#load(id: string): void {
		const gl = this.#gl;
		const entry = this.#entry(id);
		if (!gl || !entry) return;
		// A newer change supersedes one still in flight.
		this.#stopWaiting?.();
		this.#applied = id;

		const onLoad = () => {
			stop();
			this.#loaded = id;
			this.#removeExcluded(gl);
			this.#onStyleReady?.();
		};
		// "error" also fires for tiles, sprites and glyphs; only the style document failing means
		// the change failed. That is matched by URL, so a style given as an object (not a URL
		// string) can't be told apart and is never treated as failed.
		const url = typeof entry.style === "string" ? entry.style : null;
		const onError = (event: { error?: unknown }) => {
			if (url === null || !isRequestFor(event.error, url)) return;
			stop();
			this.#recover(id);
		};
		const stop = () => {
			gl.off("style.load", onLoad);
			gl.off("error", onError);
			if (this.#stopWaiting === stop) this.#stopWaiting = null;
		};
		this.#stopWaiting = stop;
		gl.on("style.load", onLoad);
		gl.on("error", onError);
		gl.setStyle(entry.style);
	}

	/**
	 * A style that fails to load leaves the map with no style, so go back to the last one that
	 * loaded and make `current` say so. When that one fails too there is nothing to draw on, and
	 * the next `select` starts a fresh attempt.
	 */
	#recover(failed: string): void {
		if (failed === this.#loaded) {
			this.#applied = null;
			return;
		}
		this.#current = this.#loaded;
		this.#load(this.#loaded);
	}
}

/** Whether a map "error" event's error is a failed request for `url`, ignoring the query. */
function isRequestFor(error: unknown, url: string): boolean {
	const failed = (error as { url?: unknown } | null | undefined)?.url;
	if (typeof failed !== "string") return false;
	return failed.split("?")[0] === url.split("?")[0];
}
