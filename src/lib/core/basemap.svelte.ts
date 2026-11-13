import { untrack } from "svelte";
import type { GlMapLike } from "./gl.js";

/** One basemap style: a variant of a basemap, such as Streets' Dark. */
export interface BasemapStyle {
	id: string;
	style: unknown;
	/** The basemap's display name ("Streets"); the variants of one basemap share it. */
	basemap?: string;
	/** The variant's display name ("Dark"). */
	name?: string;
	/** This style is its basemap's default variant. */
	isDefault?: boolean;
	/** Layers removed from this style once it loads; without it, the config's `excludedLayers`. */
	excludedLayers?: string[];
}

export interface BasemapConfig {
	styles: BasemapStyle[];
	defaultId: string;
	/** Layers removed from every style that has no `excludedLayers` of its own. */
	excludedLayers?: string[];
}

/** An id without its version and what follows it: `streets-v2-dark` → `streets`. */
function stem(id: string): string {
	return id.replace(/-v\d+(?:-.*)?$/, "");
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
 * `select`. Right before each `setStyle`, `onStyleChange` is called (it tears the plugins down,
 * so nothing touches the old style while the new one loads). After each successful load,
 * `excludedLayers` are removed and `onStyleReady` is called (it sets the plugins up again). The
 * map's first style is not announced: the plugin host already waits for it.
 */
export class BasemapState {
	#current = $state("");
	#config: BasemapConfig | undefined;
	#gl: GlMapLike | null = null;
	#onStyleReady: (() => void) | null = null;
	#onStyleChange: (() => void) | null = null;
	/** The id last handed to `setStyle` (loaded or loading); null once a load failed with no fallback. */
	#applied: string | null = null;
	/** The id the map last finished loading, which a failed change falls back to. */
	#loaded = "";
	#stopWaiting: (() => void) | null = null;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
	#fallbackHandlers = new Set<(id: string) => void>();

	constructor(config: BasemapConfig | undefined) {
		this.#config = config;
		this.#current = config?.defaultId ?? "";
	}

	/** The selected basemap id. Reactive. */
	get current(): string {
		return this.#current;
	}

	/** The configured default basemap id. */
	get defaultId(): string {
		return this.#config?.defaultId ?? "";
	}

	/** The configured styles, in order. */
	get styles(): readonly BasemapStyle[] {
		return this.#config?.styles ?? [];
	}

	/**
	 * `id` when it's listed. Otherwise its basemap's default variant, found by the id without its
	 * version (`streets-v2-dark` → a listed `streets-v…` default), and failing that the config's
	 * default. A saved id from an older MapTiler version so never leaves the map blank.
	 */
	resolve(id: string): string {
		if (this.#entry(id)) return id;
		const styles = this.styles;
		const want = stem(id);
		const kin = styles.filter((s) => stem(s.id) === want);
		const match = kin.find((s) => s.isDefault) ?? kin[0];
		return match?.id ?? this.#config?.defaultId ?? id;
	}

	/**
	 * Calls `handler` with the id the map ended up on whenever that wasn't the user's choice: a
	 * style failed to load and `current` reverted, or `select` was given an unlisted id and
	 * resolved it. Returns an unsubscribe. Nothing else (the options toolbar included) saves it.
	 */
	onFallback(handler: (id: string) => void): () => void {
		this.#fallbackHandlers.add(handler);
		return () => this.#fallbackHandlers.delete(handler);
	}

	#reportFallback(id: string): void {
		for (const handler of [...this.#fallbackHandlers]) {
			try {
				handler(id);
			} catch (error) {
				console.error("map-sdk: a basemap fallback handler failed", error);
			}
		}
	}

	/**
	 * Shows `id`, or what `resolve` makes of an unlisted one (reported through `onFallback`).
	 * While no map is attached, only `current` changes.
	 */
	select(requested: string): void {
		const id = this.resolve(requested);
		if (!this.#entry(id)) return;
		this.#current = id;
		if (id !== requested) this.#reportFallback(id);
		if (!this.#gl || id === this.#applied) return;
		this.#load(id);
	}

	/**
	 * For MapView only (through the map context's `attach`): uses `gl` from now on, which must
	 * already show (or be loading) the style of `current`. `onStyleChange` runs right before each
	 * `setStyle`, `onStyleReady` once that style has loaded. Reads `current` untracked, so calling
	 * this in an effect doesn't make it depend on it.
	 */
	attach(gl: GlMapLike, onStyleReady: () => void, onStyleChange?: () => void): void {
		if (this.#gl === gl) return;
		if (this.#gl) this.detach();
		this.#gl = gl;
		this.#onStyleReady = onStyleReady;
		this.#onStyleChange = onStyleChange ?? null;
		const id = untrack(() => this.#current);
		this.#applied = id;
		this.#loaded = id;
		// The first style: drop the excluded layers, but leave the plugin host to set itself up.
		this.#whenReady(gl, () => this.#removeExcluded(gl, id));
	}

	/** For MapView only (through the map context's `detach`): stops using the GL map. */
	detach(): void {
		this.#stopWaiting?.();
		this.#gl = null;
		this.#onStyleReady = null;
		this.#onStyleChange = null;
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

	#removeExcluded(gl: GlMapLike, id: string): void {
		const own = this.#entry(id)?.excludedLayers;
		for (const layerId of own ?? this.#config?.excludedLayers ?? []) {
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
			this.#removeExcluded(gl, id);
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
		this.#onStyleChange?.();
		// No diffing: a diff keeps the plugins' sources and layers in some cases and not others.
		gl.setStyle(entry.style, { diff: false });
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
		this.#reportFallback(this.#loaded);
		this.#load(this.#loaded);
	}
}

/** Whether a map "error" event's error is a failed request for `url`, ignoring the query. */
function isRequestFor(error: unknown, url: string): boolean {
	const failed = (error as { url?: unknown } | null | undefined)?.url;
	if (typeof failed !== "string") return false;
	return failed.split("?")[0] === url.split("?")[0];
}
