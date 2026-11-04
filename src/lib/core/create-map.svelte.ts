import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { createDefaultFormat, type FormatProvider } from "../data/format.js";
import { defaultMessages, type MessageProvider } from "../data/messages.js";
import { createDefaultMetadata, type MetadataProvider } from "../data/metadata.js";
import { applyPick, selectionKeys } from "../data/selection.js";
import type { FeatureRef, SelectionMode, SpatialSelection } from "../data/types.js";
import { BasemapState, type BasemapConfig } from "./basemap.svelte.js";
import type { GlMapLike } from "./gl.js";
import { InteractionRouter, type Hovered } from "./interactions.svelte.js";
import type { ClickEvent, FeatureHit, FeatureListItem, MapPlugin } from "./plugin.js";
import { PluginHost } from "./plugin-host.svelte.js";

export interface CameraState {
	center: [number, number];
	zoom: number;
	bearing: number;
	pitch: number;
}

export interface Bounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

export interface MapConfig {
	maptilerKey: string;
	basemaps?: BasemapConfig;
	initialView?: CameraState;
	cooperativeGestures?: boolean;
}

export interface CreateMapOptions {
	config: MapConfig;
	metadata?: MetadataProvider;
	messages?: MessageProvider;
	format?: FormatProvider;
}

export interface PluginOptions {
	/**
	 * Draw the plugin just below the plugin with this id (which must be added already). Without
	 * it the plugin goes on top.
	 */
	before?: string;
	selectionMode?: SelectionMode;
	selection?: SpatialSelection | null;
	onselectionchange?(sel: SpatialSelection | null): void;
}

export type FeatureClickHandler = (e: { pluginId: string; ref: FeatureRef }) => void;

/** A map's state and services, independent of whether a GL map currently exists. */
export interface MapContext {
	readonly uid: string;
	readonly config: Readonly<MapConfig>;
	readonly metadata: MetadataProvider;
	readonly messages: MessageProvider;
	readonly format: FormatProvider;
	/** Reactive; updated by MapView on moveend. */
	readonly camera: CameraState;
	/** Reactive; `null` until a map reports its bounds. */
	readonly bounds: Bounds | null;
	readonly basemap: BasemapState;
	/**
	 * In draw order, bottom first: later plugins draw above earlier ones, and each plugin's layers
	 * stay together. Reactive.
	 */
	readonly plugins: readonly MapPlugin[];
	/** Reactive. */
	readonly attached: boolean;
	/**
	 * Adds a plugin on top, or below `options.before`. Throws if a plugin with the same id is
	 * already added, if `before` names no added plugin, or after `destroy()`.
	 */
	addPlugin(plugin: MapPlugin, options?: PluginOptions): void;
	/**
	 * Moves a plugin and its layers to the top, or just below `options.before`. Does nothing for
	 * an unknown `id`; throws if `before` names no added plugin.
	 */
	movePlugin(id: string, options?: { before?: string }): void;
	/** Tears the plugin down and forgets its selection, mode, and `onselectionchange`. */
	removePlugin(id: string): void;
	/**
	 * Host → map. Kept as given, including ids not in any data. Does not call
	 * `onselectionchange`.
	 */
	setSelection(pluginId: string, selection: SpatialSelection | null): void;
	/** Reactive. */
	getSelection(pluginId: string): SpatialSelection | null;
	setSelectionMode(pluginId: string, mode: SelectionMode): void;
	/** Reactive. `"none"` for an unknown plugin. */
	getSelectionMode(pluginId: string): SelectionMode;
	/**
	 * Internal, for FeatureList: picks a listed feature exactly like a map click on it. Fires
	 * `featureclick`, then applies the same selection rules (`additive` adds or toggles in
	 * `multiple` mode), calling `onselectionchange` if the selection changes. An item that isn't
	 * selectable is still clicked but not selected. Does nothing for a refKey the plugin doesn't list.
	 */
	pickFromList(pluginId: string, refKey: string, additive: boolean): void;
	/**
	 * Internal, for the selection bar: the user clears a plugin's selection. Calls the plugin's
	 * `onselectionchange(null)` when it had a selection; does nothing otherwise.
	 */
	clearSelection(pluginId: string): void;
	/**
	 * Called for every feature click (the top hit), whatever the selection mode, before the
	 * selection changes. Returns an unsubscribe function.
	 */
	on(event: "featureclick", handler: FeatureClickHandler): () => void;
	/** Hits under a canvas point, topmost first. `[]` while detached. */
	featuresAt(point: { x: number; y: number }): FeatureHit[];
	/**
	 * The hit for a feature-list element: the nearest `[data-mapsdk-ref]` ancestor (or the element
	 * itself), looked up in the plugins' `features()`: in the row's `data-mapsdk-plugin` plugin when
	 * it names one, else the first plugin listing the refKey. Only rows inside this map's own root count:
	 * the row's nearest `[data-mapsdk-map]` ancestor must carry this map's `uid`, which MapView
	 * sets on its container and FeatureList on its root. `null` otherwise.
	 */
	featureForElement(element: Element): FeatureHit | null;
	/**
	 * The top feature under the pointer and where it is. Reactive, for the tooltip. Over a cluster
	 * bubble it is the bubble's own hit: a `{ kind: "feature", id: "cluster:…" }` ref no plugin
	 * lists, with the bubble's `properties`, never a feature beneath it.
	 */
	readonly hovered: Hovered | null;
	/**
	 * Marks the feature focused and pans to it (no animation under reduced motion): the item in
	 * `pluginId`'s features when given, else the first plugin listing `refKey`. `null` clears the
	 * focus without moving the camera. Sets `focusedPluginId` to `pluginId` (or `null`).
	 */
	focusFeature(refKey: string | null, pluginId?: string): void;
	/** Reactive. */
	readonly focusedKey: string | null;
	/** Reactive. The plugin `focusFeature` was given with `focusedKey`, or `null`. */
	readonly focusedPluginId: string | null;
	/** For MapView only: uses `gl` from now on. */
	attach(gl: GlMapLike): void;
	/** For MapView only: stops using the current GL map. */
	detach(): void;
	/** For MapView only: records the camera and bounds after a move. */
	updateView(camera: CameraState, bounds: Bounds): void;
	/**
	 * For MapView only: the host's theme changed, so plugins set up again and re-read the theme
	 * colors they bake into paint and images. Does nothing while detached.
	 */
	themeChanged(): void;
	/** Detaches, removes every plugin, and drops handlers. The context can't be used after. */
	destroy(): void;
}

/** Monitor-map's start view. */
const DEFAULT_VIEW: CameraState = {
	center: [-119.7987626619462, 36.76272050981146],
	zoom: 7,
	bearing: 0,
	pitch: 0
};

/** One plugin's selection state. */
class PluginSelection {
	mode = $state<SelectionMode>("none");
	selection = $state.raw<SpatialSelection | null>(null);
	onselectionchange: PluginOptions["onselectionchange"];
}

function copyView(view: CameraState): CameraState {
	return { ...view, center: [view.center[0], view.center[1]] };
}

function copySelection(sel: SpatialSelection | null): SpatialSelection | null {
	return sel && { kind: sel.kind, ids: [...sel.ids] };
}

/** 8 hex characters. `crypto.randomUUID` is missing on insecure origins (a dev server on a LAN IP). */
function randomUid(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(4));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameSelection(a: SpatialSelection | null, b: SpatialSelection | null): boolean {
	if (!a || !b) return a === b;
	return (
		a.kind === b.kind && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i])
	);
}

function prefersReducedMotion(): boolean {
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

class MapContextImpl implements MapContext {
	readonly uid = randomUid();
	readonly config: Readonly<MapConfig>;
	readonly metadata: MetadataProvider;
	readonly messages: MessageProvider;
	readonly format: FormatProvider;
	readonly basemap: BasemapState;

	#camera = $state.raw<CameraState>(DEFAULT_VIEW);
	#bounds = $state.raw<Bounds | null>(null);
	#attached = $state(false);
	#focusedKey = $state<string | null>(null);
	#focusedPluginId = $state<string | null>(null);
	#selections = new SvelteMap<string, PluginSelection>();
	#featureClickHandlers = new Set<FeatureClickHandler>();
	#router = new InteractionRouter();
	#host: PluginHost;
	#gl: GlMapLike | null = null;
	#destroyed = false;

	constructor(options: CreateMapOptions) {
		const initialView = copyView(options.config.initialView ?? DEFAULT_VIEW);
		this.config = {
			...options.config,
			initialView,
			cooperativeGestures: options.config.cooperativeGestures ?? false
		};
		this.metadata = options.metadata ?? createDefaultMetadata();
		this.messages = options.messages ?? defaultMessages;
		this.format = options.format ?? createDefaultFormat();
		this.basemap = new BasemapState(options.config.basemaps);
		this.#camera = copyView(initialView);
		this.#host = new PluginHost({
			mapUid: this.uid,
			providers: { metadata: this.metadata, messages: this.messages, format: this.format },
			router: this.#router,
			selectedKeys: (pluginId) => selectionKeys(this.getSelection(pluginId))
		});
		this.#router.onPick((e) => this.#pick(e));
	}

	get camera(): CameraState {
		return this.#camera;
	}

	get bounds(): Bounds | null {
		return this.#bounds;
	}

	get plugins(): readonly MapPlugin[] {
		return this.#host.plugins;
	}

	get attached(): boolean {
		return this.#attached;
	}

	get focusedKey(): string | null {
		return this.#focusedKey;
	}

	get focusedPluginId(): string | null {
		return this.#focusedPluginId;
	}

	get hovered(): Hovered | null {
		return this.#router.hovered;
	}

	addPlugin(plugin: MapPlugin, options: PluginOptions = {}): void {
		this.#assertAlive();
		const previous = untrack(() => this.#selections.get(plugin.id));
		const state = new PluginSelection();
		// Untracked: addPlugin may be called from inside an effect (e.g. a host component's).
		untrack(() => {
			state.mode = options.selectionMode ?? previous?.mode ?? "none";
			state.selection =
				options.selection !== undefined
					? copySelection(options.selection)
					: (previous?.selection ?? null);
		});
		state.onselectionchange = options.onselectionchange ?? previous?.onselectionchange;
		// Stored before the host adds it, so a setup that runs at once sees its selection.
		this.#selections.set(plugin.id, state);
		try {
			this.#host.add(plugin, options.before);
		} catch (error) {
			if (previous) this.#selections.set(plugin.id, previous);
			else this.#selections.delete(plugin.id);
			throw error;
		}
	}

	movePlugin(id: string, options: { before?: string } = {}): void {
		if (this.#destroyed) return;
		this.#host.move(id, options.before);
	}

	removePlugin(id: string): void {
		this.#host.remove(id);
		this.#selections.delete(id);
	}

	setSelection(pluginId: string, selection: SpatialSelection | null): void {
		if (this.#destroyed) return;
		this.#stateFor(pluginId).selection = copySelection(selection);
	}

	getSelection(pluginId: string): SpatialSelection | null {
		return this.#selections.get(pluginId)?.selection ?? null;
	}

	getSelectionMode(pluginId: string): SelectionMode {
		return this.#selections.get(pluginId)?.mode ?? "none";
	}

	pickFromList(pluginId: string, refKey: string, additive: boolean): void {
		if (this.#destroyed) return;
		const found = untrack(() => this.#findItem(refKey, pluginId));
		if (!found) return;
		this.#emitClick(pluginId, found.item.ref);
		if (found.item.selectable) this.#applyPick(pluginId, found.item.ref, additive);
	}

	clearSelection(pluginId: string): void {
		if (this.#destroyed) return;
		const state = untrack(() => this.#selections.get(pluginId));
		if (!state || !untrack(() => state.selection)) return;
		state.selection = null;
		state.onselectionchange?.(null);
	}

	setSelectionMode(pluginId: string, mode: SelectionMode): void {
		if (this.#destroyed) return;
		this.#stateFor(pluginId).mode = mode;
	}

	on(event: "featureclick", handler: FeatureClickHandler): () => void {
		if (this.#destroyed) return () => {};
		this.#featureClickHandlers.add(handler);
		return () => {
			this.#featureClickHandlers.delete(handler);
		};
	}

	featuresAt(point: { x: number; y: number }): FeatureHit[] {
		return this.#router.hitsAt([point.x, point.y]);
	}

	featureForElement(element: Element): FeatureHit | null {
		const row = element.closest("[data-mapsdk-ref]");
		if (!row || row.closest("[data-mapsdk-map]")?.getAttribute("data-mapsdk-map") !== this.uid) {
			return null;
		}
		const refKey = row.getAttribute("data-mapsdk-ref") ?? "";
		const pluginId = row.getAttribute("data-mapsdk-plugin") ?? undefined;
		const found = untrack(() => this.#findItem(refKey, pluginId));
		if (!found) return null;
		const { plugin, item } = found;
		return { pluginId: plugin.id, ref: item.ref, refKey: item.refKey, name: item.name };
	}

	focusFeature(refKey: string | null, pluginId?: string): void {
		if (this.#destroyed) return;
		this.#focusedKey = refKey;
		this.#focusedPluginId = refKey === null ? null : (pluginId ?? null);
		const gl = this.#gl;
		if (!gl || refKey === null) return;
		const found = untrack(() => this.#findItem(refKey, pluginId));
		if (!found) return;
		gl.easeTo({ center: found.item.lngLat, ...(prefersReducedMotion() && { duration: 0 }) });
	}

	attach(gl: GlMapLike): void {
		this.#assertAlive();
		if (this.#gl === gl) return;
		if (this.#gl) this.detach();
		this.#gl = gl;
		this.#host.attach(gl);
		this.#router.attach(gl);
		this.basemap.attach(
			gl,
			() => this.#host.restyle(),
			() => this.#host.suspend()
		);
		this.#attached = true;
	}

	detach(): void {
		if (!this.#gl) return;
		this.#router.detach();
		this.basemap.detach();
		this.#host.detach();
		this.#gl = null;
		this.#attached = false;
	}

	themeChanged(): void {
		if (this.#gl) this.#host.restyle();
	}

	updateView(camera: CameraState, bounds: Bounds): void {
		this.#camera = copyView(camera);
		this.#bounds = { ...bounds };
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.detach();
		for (const plugin of untrack(() => this.plugins)) this.#host.remove(plugin.id);
		this.#selections.clear();
		this.#featureClickHandlers.clear();
		this.#focusedKey = null;
		this.#focusedPluginId = null;
		this.#destroyed = true;
	}

	/** A click on a feature: report it, then apply it to the top hit's plugin's selection. */
	#pick(e: ClickEvent): void {
		if (this.#destroyed) return;
		const [{ pluginId, ref }] = e.hits;
		this.#emitClick(pluginId, ref);
		this.#applyPick(pluginId, ref, e.additive);
	}

	#emitClick(pluginId: string, ref: FeatureRef): void {
		for (const handler of [...this.#featureClickHandlers]) {
			try {
				handler({ pluginId, ref });
			} catch (error) {
				console.error("map-sdk: a featureclick handler failed", error);
			}
		}
	}

	/** The one place a user's pick (map click or list key) changes a plugin's selection. */
	#applyPick(pluginId: string, ref: FeatureRef, additive: boolean): void {
		// A featureclick handler may have removed the plugin.
		const state = untrack(() => this.#selections.get(pluginId));
		if (!state) return;
		const current = untrack(() => state.selection);
		const next = applyPick(
			current,
			ref,
			untrack(() => state.mode),
			{ additive }
		);
		if (sameSelection(current, next)) return;
		state.selection = next;
		state.onselectionchange?.(copySelection(next));
	}

	/**
	 * A listed item and its plugin: in `pluginId` when given (`null` if that plugin doesn't list
	 * it), else the first plugin listing `refKey`. Reads `features()`, so call it untracked.
	 */
	#findItem(
		refKey: string,
		pluginId?: string
	): { plugin: MapPlugin; item: FeatureListItem } | null {
		for (const plugin of this.plugins) {
			if (pluginId !== undefined && plugin.id !== pluginId) continue;
			const item = plugin.features?.().find((f) => f.refKey === refKey);
			if (item) return { plugin, item };
		}
		return null;
	}

	#stateFor(pluginId: string): PluginSelection {
		let state = untrack(() => this.#selections.get(pluginId));
		if (!state) {
			state = new PluginSelection();
			this.#selections.set(pluginId, state);
		}
		return state;
	}

	#assertAlive(): void {
		if (this.#destroyed) throw new Error("map destroyed");
	}
}

/** Creates a map's state and services. `MapView` attaches a GL map to it. */
export function createMap(options: CreateMapOptions): MapContext {
	return new MapContextImpl(options);
}
