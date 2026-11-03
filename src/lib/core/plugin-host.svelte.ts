import type { LayerSpecification } from "@maptiler/sdk";
import { untrack } from "svelte";
import type { GlMapLike } from "./gl.js";
import type { InteractionRouter } from "./interactions.js";
import type { MapPlugin, PluginContext, Providers } from "./plugin.js";

export interface PluginHostOptions {
	mapUid: string;
	providers: Providers;
	router: InteractionRouter;
	/** Reactive: read inside a plugin's effects. */
	selectedKeys(pluginId: string): ReadonlySet<string>;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- MapLibre's event payloads vary by type */
type Listener = (e: any) => void;

/** Setup runs on whichever of these fires first. */
const STYLE_READY_EVENTS = ["style.load", "idle"] as const;

/** Everything one running plugin added through its context, so the host can remove it. */
interface Running {
	gl: GlMapLike;
	dead: boolean;
	teardown: (() => void) | null;
	effects: Array<() => void>;
	layers: string[];
	sources: string[];
	images: string[];
	listeners: Array<{ type: string; layerId: string; listener: Listener }>;
	unregisters: Array<() => void>;
}

/**
 * Runs plugins against a GL map. Plugins are set up only when the map's style is loaded, and
 * everything they add through their `PluginContext` is removed on teardown, whatever their own
 * teardown does. The plugin list outlives any one GL map.
 */
export class PluginHost {
	#opts: PluginHostOptions;
	#plugins = $state.raw<readonly MapPlugin[]>([]);
	// Bookkeeping only; nothing reads it reactively.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#running = new Map<string, Running>();
	#gl: GlMapLike | null = null;
	/** True once the current gl's style has loaded and plugins are set up on it. */
	#live = false;
	/**
	 * The pending one-shot listener on `#gl` for `style.load` and `idle`, if waiting. `idle` covers
	 * a style that already loaded while `isStyleLoaded()` is false because sources are loading.
	 */
	#onStyleLoad: (() => void) | null = null;

	constructor(opts: PluginHostOptions) {
		this.#opts = opts;
	}

	/** In the order added. Reactive. */
	get plugins(): readonly MapPlugin[] {
		return this.#plugins;
	}

	/**
	 * The host's own reads are untracked, so calling `add`, `attach`, etc. from inside an effect
	 * doesn't make that effect depend on the plugin list.
	 */
	get #list(): readonly MapPlugin[] {
		return untrack(() => this.#plugins);
	}

	add(plugin: MapPlugin): void {
		if (this.#list.some((p) => p.id === plugin.id)) {
			throw new Error(`map-sdk: a plugin with id "${plugin.id}" is already added`);
		}
		this.#plugins = [...this.#list, plugin];
		if (this.#live) this.#setup(plugin);
	}

	remove(id: string): void {
		if (!this.#list.some((p) => p.id === id)) return;
		this.#teardown(id);
		this.#plugins = this.#list.filter((p) => p.id !== id);
	}

	/** Uses `gl` from now on, setting up every plugin once its style is loaded. */
	attach(gl: GlMapLike): void {
		if (this.#gl === gl) return;
		if (this.#gl) this.detach();
		this.#gl = gl;
		this.#whenStyleLoaded();
	}

	/** Tears down and sets up every plugin again (after a basemap change), once the style loads. */
	restyle(): void {
		if (!this.#gl) return;
		this.#teardownAll();
		this.#whenStyleLoaded();
	}

	/** Tears down every plugin. The gl is not touched after this returns. */
	detach(): void {
		const gl = this.#gl;
		if (!gl) return;
		this.#cancelStyleWait();
		this.#teardownAll();
		this.#gl = null;
	}

	#whenStyleLoaded(): void {
		const gl = this.#gl!;
		this.#cancelStyleWait();
		if (gl.isStyleLoaded()) {
			this.#setupAll();
			return;
		}
		const onStyleLoad = () => {
			// Stale if the host was detached, re-attached, or restyled since.
			if (this.#onStyleLoad !== onStyleLoad || this.#gl !== gl) return;
			this.#cancelStyleWait();
			this.#setupAll();
		};
		this.#onStyleLoad = onStyleLoad;
		for (const type of STYLE_READY_EVENTS) gl.on(type, onStyleLoad);
	}

	#cancelStyleWait(): void {
		const listener = this.#onStyleLoad;
		if (listener && this.#gl) {
			for (const type of STYLE_READY_EVENTS) this.#gl.off(type, listener);
		}
		this.#onStyleLoad = null;
	}

	#setupAll(): void {
		const gl = this.#gl;
		this.#live = true;
		for (const plugin of this.#list) {
			// A plugin's setup may add, remove, or detach; follow the host's current state.
			if (this.#gl !== gl || !this.#live) return;
			if (!this.#list.includes(plugin) || this.#running.has(plugin.id)) continue;
			this.#setup(plugin);
		}
	}

	#teardownAll(): void {
		this.#live = false;
		for (const plugin of this.#list) this.#teardown(plugin.id);
	}

	#setup(plugin: MapPlugin): void {
		const gl = this.#gl!;
		const running: Running = {
			gl,
			dead: false,
			teardown: null,
			effects: [],
			layers: [],
			sources: [],
			images: [],
			listeners: [],
			unregisters: []
		};
		this.#running.set(plugin.id, running);
		const ctx = this.#context(plugin.id, running);
		let teardown: () => void;
		try {
			// Untracked: setup may be called from inside an effect (e.g. MapView's).
			teardown = untrack(() => plugin.setup(ctx));
		} catch (error) {
			console.error(`map-sdk: plugin "${plugin.id}" setup failed`, error);
			if (this.#running.get(plugin.id) === running) this.#teardown(plugin.id);
			return;
		}
		if (!running.dead) {
			running.teardown = teardown;
			return;
		}
		// Torn down during its own setup (it removed itself or detached the host).
		try {
			untrack(teardown);
		} catch (error) {
			console.error(`map-sdk: plugin "${plugin.id}" teardown failed`, error);
		}
	}

	#teardown(pluginId: string): void {
		const running = this.#running.get(pluginId);
		if (!running) return;
		this.#running.delete(pluginId);
		running.dead = true;
		const { gl } = running;
		const attempt = (what: string, fn: () => void) => {
			try {
				fn();
			} catch (error) {
				console.error(`map-sdk: plugin "${pluginId}" ${what} failed`, error);
			}
		};
		// Effects stop first so none re-runs against a half-removed plugin.
		for (const stop of running.effects) attempt("effect cleanup", stop);
		if (running.teardown) attempt("teardown", untrack.bind(null, running.teardown));
		// A style change may already have dropped these, so check before removing.
		for (const id of running.layers.toReversed()) {
			attempt(`removing layer ${id}`, () => gl.getLayer(id) && gl.removeLayer(id));
		}
		for (const id of running.sources.toReversed()) {
			attempt(`removing source ${id}`, () => gl.getSource(id) && gl.removeSource(id));
		}
		for (const id of running.images) {
			attempt(`removing image ${id}`, () => gl.hasImage(id) && gl.removeImage(id));
		}
		for (const { type, layerId, listener } of running.listeners) {
			attempt(`removing ${type} listener`, () => gl.off(type, layerId, listener));
		}
		for (const unregister of running.unregisters) attempt("unregistering", unregister);
	}

	#context(pluginId: string, running: Running): PluginContext {
		const { mapUid, providers, router, selectedKeys } = this.#opts;
		const { gl } = running;
		const id = (local: string) => `${mapUid}:${pluginId}:${local}`;
		return {
			gl,
			id,
			metadata: providers.metadata,
			messages: providers.messages,
			format: providers.format,
			addSource(local, spec) {
				const full = id(local);
				if (running.dead) return full;
				gl.addSource(full, spec);
				running.sources.push(full);
				return full;
			},
			addLayer(local, spec) {
				const full = id(local);
				if (running.dead) return full;
				gl.addLayer({ ...spec, id: full } as LayerSpecification);
				running.layers.push(full);
				return full;
			},
			addImage(local, image) {
				if (running.dead) return;
				const full = id(local);
				gl.addImage(full, image);
				running.images.push(full);
			},
			interactive(layerIds, toHit) {
				if (running.dead) return;
				running.unregisters.push(router.register(pluginId, layerIds, toHit));
			},
			on(type, layerId, listener) {
				if (running.dead) return;
				gl.on(type, layerId, listener);
				running.listeners.push({ type, layerId, listener });
			},
			get selectedKeys() {
				return selectedKeys(pluginId);
			},
			effect(fn) {
				if (running.dead) return;
				running.effects.push(
					$effect.root(() => {
						$effect(fn);
					})
				);
			}
		};
	}
}
