import type { CustomLayerInterface, LayerSpecification } from "@maptiler/sdk";
import { untrack } from "svelte";
import type { GlMapLike } from "./gl.js";
import type { InteractionRouter } from "./interactions.svelte.js";
import type { MapPlugin, PluginContext, Providers } from "./plugin.js";

export interface PluginHostOptions {
	mapUid: string;
	providers: Providers;
	router: InteractionRouter;
	/** Reactive: read inside a plugin's effects. */
	selectedKeys(pluginId: string): ReadonlySet<string>;
	/**
	 * Called after each queued setup run finishes (also when it had nothing to do), never after a
	 * synchronous one.
	 */
	onSettled?: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- MapLibre's event payloads vary by type */
type Listener = (e: any) => void;

/** Setup runs on whichever of these fires first. */
const STYLE_READY_EVENTS = ["style.load", "idle"] as const;

/**
 * Marks a plugin object with the host it is set up on, while it is. A plugin object keeps
 * per-map state (its source and layer ids, its features), so it belongs to one map at a time.
 * A property on the plugin, not a registry: nothing here is shared between maps.
 */
const OWNER = Symbol("map-sdk plugin host");
type Owned = MapPlugin & { [OWNER]?: PluginHost };

function ownedElsewhere(plugin: MapPlugin, host: PluginHost): boolean {
	const owner = (plugin as Owned)[OWNER];
	return owner !== undefined && owner !== host;
}

function ownershipError(plugin: MapPlugin): Error {
	return new Error(
		`map-sdk: plugin "${plugin.id}" is already set up on another map; create one plugin per map`
	);
}

/** Everything one running plugin added through its context, so the host can remove it. */
interface Running {
	plugin: MapPlugin;
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
 *
 * Setup never runs inside the caller's code. When `add` or `attach` would set plugins up, they
 * are queued and set up in one microtask, where no effect is active: Svelte cuts loose the
 * `$effect.root`s created inside an effect when that effect re-runs, and their effects can stop
 * (see docs/superpowers/specs/2026-11-07-plugin-setup-outside-effects-design.md). Setup on a
 * style load or `restyle` comes from map events, not host code, and stays synchronous.
 *
 * Plugins draw in list order, later on top: each plugin's layers stay together, below the first
 * layer of the next plugin in the list that has any.
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
	/** True from scheduling a queued setup run until it starts. */
	#setupQueued = false;

	constructor(opts: PluginHostOptions) {
		this.#opts = opts;
	}

	/** In draw order, bottom first. Reactive. */
	get plugins(): readonly MapPlugin[] {
		return this.#plugins;
	}

	/** True while a setup run is queued and has not started. Not reactive. */
	get pending(): boolean {
		return this.#setupQueued;
	}

	/**
	 * The host's own reads are untracked, so calling `add`, `attach`, etc. from inside an effect
	 * doesn't make that effect depend on the plugin list.
	 */
	get #list(): readonly MapPlugin[] {
		return untrack(() => this.#plugins);
	}

	/**
	 * Adds `plugin` on top, or just below the plugin `before` names. It is in `plugins` at once;
	 * on a live map its setup runs in a microtask. Throws when the same plugin object is set up on
	 * another map at the moment (one plugin object per map).
	 */
	add(plugin: MapPlugin, before?: string): void {
		if (this.#list.some((p) => p.id === plugin.id)) {
			throw new Error(`map-sdk: a plugin with id "${plugin.id}" is already added`);
		}
		if (ownedElsewhere(plugin, this)) throw ownershipError(plugin);
		this.#plugins = this.#inserted(this.#list, plugin, before);
		if (this.#live) this.#queueSetup();
	}

	/**
	 * Moves a plugin to the top, or just below the plugin `before` names, with its layers. Does
	 * nothing for an unknown `id` or when `before` is `id`.
	 */
	move(id: string, before?: string): void {
		const plugin = this.#list.find((p) => p.id === id);
		if (!plugin || before === id) return;
		this.#plugins = this.#inserted(
			this.#list.filter((p) => p !== plugin),
			plugin,
			before
		);
		const running = this.#running.get(id);
		if (!running || running.gl !== this.#gl) return;
		const { gl } = running;
		const beforeId = this.#layerAbove(id);
		for (const layerId of running.layers) {
			try {
				if (gl.getLayer(layerId)) gl.moveLayer(layerId, beforeId);
			} catch (error) {
				console.error(`map-sdk: plugin "${id}" moving layer ${layerId} failed`, error);
			}
		}
	}

	/** `list` with `plugin` inserted before `before` (at the end without it). */
	#inserted(list: readonly MapPlugin[], plugin: MapPlugin, before?: string): MapPlugin[] {
		if (before === undefined) return [...list, plugin];
		const at = list.findIndex((p) => p.id === before);
		if (at < 0) throw new Error(`map-sdk: no plugin with id "${before}"`);
		return [...list.slice(0, at), plugin, ...list.slice(at)];
	}

	/**
	 * The bottom layer of the plugins drawn above `pluginId` on the current gl: where its layers
	 * go. `undefined` (the top) when none above has a layer.
	 */
	#layerAbove(pluginId: string): string | undefined {
		const gl = this.#gl;
		if (!gl) return undefined;
		const list = this.#list;
		for (const plugin of list.slice(list.findIndex((p) => p.id === pluginId) + 1)) {
			const running = this.#running.get(plugin.id);
			if (running?.gl !== gl) continue;
			const layerId = running.layers.find((l) => gl.getLayer(l));
			if (layerId !== undefined) return layerId;
		}
		return undefined;
	}

	remove(id: string): void {
		if (!this.#list.some((p) => p.id === id)) return;
		this.#teardown(id);
		this.#plugins = this.#list.filter((p) => p.id !== id);
	}

	/**
	 * Uses `gl` from now on, setting up every plugin once its style is loaded (in a microtask when
	 * it already is).
	 */
	attach(gl: GlMapLike): void {
		if (this.#gl === gl) return;
		if (this.#gl) this.detach();
		this.#gl = gl;
		this.#whenStyleLoaded(false);
	}

	/**
	 * Tears every plugin down and stops waiting for a style, before the map's style is replaced:
	 * nothing may touch a style on its way out. `restyle` sets them up again.
	 */
	suspend(): void {
		if (!this.#gl) return;
		this.#cancelStyleWait();
		this.#teardownAll();
	}

	/** Tears down and sets up every plugin again (after a basemap change), once the style loads. */
	restyle(): void {
		if (!this.#gl) return;
		this.#teardownAll();
		this.#whenStyleLoaded(true);
	}

	/** Tears down every plugin. The gl is not touched after this returns. */
	detach(): void {
		const gl = this.#gl;
		if (!gl) return;
		this.#cancelStyleWait();
		this.#teardownAll();
		this.#gl = null;
	}

	/**
	 * Sets every plugin up once the style is loaded. On a style that already is, `now` sets them up
	 * synchronously (only for callers that never run inside an effect); otherwise they are queued.
	 */
	#whenStyleLoaded(now: boolean): void {
		const gl = this.#gl!;
		this.#cancelStyleWait();
		if (gl.isStyleLoaded()) {
			if (now) {
				this.#setupAll();
			} else {
				// Live already, so an `add` before the microtask joins the queued run.
				this.#live = true;
				this.#queueSetup();
			}
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

	/**
	 * Sets every plugin that isn't running up in a microtask, unless the host was detached,
	 * suspended, or moved to another gl since. One run covers every request made before it starts.
	 */
	#queueSetup(): void {
		if (this.#setupQueued) return;
		this.#setupQueued = true;
		const gl = this.#gl;
		queueMicrotask(() => {
			this.#setupQueued = false;
			if (this.#gl === gl && this.#live) this.#setupAll();
			this.#opts.onSettled?.();
		});
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
			// Another map set this plugin object up after it was added here.
			if (ownedElsewhere(plugin, this)) {
				console.error(ownershipError(plugin));
				continue;
			}
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
			plugin,
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
		if (Object.isExtensible(plugin)) (plugin as Owned)[OWNER] = this;
		const ctx = this.#context(plugin.id, running);
		let teardown: () => void;
		try {
			// Untracked, in case a plugin's setup reads state (setup runs from a microtask or a map
			// event, never inside the caller's effect).
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
		const owned = running.plugin as Owned;
		if (owned[OWNER] === this) delete owned[OWNER];
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
		const layerAbove = () => this.#layerAbove(pluginId);
		const id = (local: string) => `${mapUid}:${pluginId}:${local}`;
		const addTracked = (full: string, layer: LayerSpecification | CustomLayerInterface) => {
			if (running.dead) return full;
			gl.addLayer(layer, layerAbove());
			// A re-added layer (a plugin rebuilding its layers) is now its plugin's top layer.
			const at = running.layers.indexOf(full);
			if (at >= 0) running.layers.splice(at, 1);
			running.layers.push(full);
			return full;
		};
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
				return addTracked(id(local), { ...spec, id: id(local) } as LayerSpecification);
			},
			addCustomLayer(local, create) {
				const full = id(local);
				if (running.dead) return full;
				const layer = create(full);
				if (layer.id !== full) {
					throw new Error(`map-sdk: custom layer "${local}" must use the id it is given (${full})`);
				}
				return addTracked(full, layer);
			},
			addImage(local, image) {
				if (running.dead) return;
				const full = id(local);
				gl.addImage(full, image);
				running.images.push(full);
			},
			interactive(layerIds, toHit) {
				if (running.dead) return;
				running.unregisters.push(
					router.register(pluginId, layerIds, toHit, running.plugin.hoverPriority ?? 0)
				);
			},
			blocking(layerIds, toHover, onClick) {
				if (running.dead) return;
				running.unregisters.push(
					router.registerBlocking(
						pluginId,
						layerIds,
						toHover,
						onClick,
						running.plugin.hoverPriority ?? 0
					)
				);
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
