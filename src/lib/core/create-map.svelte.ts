import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { createDefaultFormat, type FormatProvider } from "../data/format.js";
import { defaultMessages, type MessageProvider } from "../data/messages.js";
import { createDefaultMetadata, type MetadataProvider } from "../data/metadata.js";
import { selectionKeys } from "../data/selection.js";
import type { FeatureRef, SelectionMode, SpatialSelection } from "../data/types.js";
import { BasemapState, type BasemapConfig } from "./basemap.svelte.js";
import type { GlMapLike } from "./gl.js";
import { InteractionRouter } from "./interactions.js";
import type { FeatureHit, MapPlugin } from "./plugin.js";
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
	/** In the order added. Reactive. */
	readonly plugins: readonly MapPlugin[];
	/** Reactive. */
	readonly attached: boolean;
	/** Throws if a plugin with the same id is already added, or after `destroy()`. */
	addPlugin(plugin: MapPlugin, options?: PluginOptions): void;
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
	/**
	 * Called for every feature click, whatever the selection mode. Returns an unsubscribe
	 * function. Handlers are stored now and fired once interactions are wired (Task 10).
	 */
	on(event: "featureclick", handler: FeatureClickHandler): () => void;
	/** Hits under a canvas point, topmost first. Returns `[]` until interactions are wired (Task 10). */
	featuresAt(point: { x: number; y: number }): FeatureHit[];
	/** The hit for a feature-list element. Returns `null` until interactions are wired (Task 10). */
	featureForElement(element: Element): FeatureHit | null;
	/** Marks the feature focused and pans to it (no animation under reduced motion). */
	focusFeature(refKey: string): void;
	/** Reactive. */
	readonly focusedKey: string | null;
	/** For MapView only: uses `gl` from now on. */
	attach(gl: GlMapLike): void;
	/** For MapView only: stops using the current GL map. */
	detach(): void;
	/** For MapView only: records the camera and bounds after a move. */
	updateView(camera: CameraState, bounds: Bounds): void;
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

function prefersReducedMotion(): boolean {
	return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

class MapContextImpl implements MapContext {
	readonly uid = crypto.randomUUID().slice(0, 8);
	readonly config: Readonly<MapConfig>;
	readonly metadata: MetadataProvider;
	readonly messages: MessageProvider;
	readonly format: FormatProvider;
	readonly basemap: BasemapState;

	#camera = $state.raw<CameraState>(DEFAULT_VIEW);
	#bounds = $state.raw<Bounds | null>(null);
	#attached = $state(false);
	#focusedKey = $state<string | null>(null);
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

	addPlugin(plugin: MapPlugin, options: PluginOptions = {}): void {
		this.#assertAlive();
		const previous = untrack(() => this.#selections.get(plugin.id));
		const state = new PluginSelection();
		state.mode = options.selectionMode ?? previous?.mode ?? "none";
		state.selection =
			options.selection !== undefined
				? copySelection(options.selection)
				: (previous?.selection ?? null);
		state.onselectionchange = options.onselectionchange ?? previous?.onselectionchange;
		// Stored before the host adds it, so a setup that runs at once sees its selection.
		this.#selections.set(plugin.id, state);
		try {
			this.#host.add(plugin);
		} catch (error) {
			if (previous) this.#selections.set(plugin.id, previous);
			else this.#selections.delete(plugin.id);
			throw error;
		}
	}

	removePlugin(id: string): void {
		this.#host.remove(id);
		this.#selections.delete(id);
	}

	setSelection(pluginId: string, selection: SpatialSelection | null): void {
		this.#stateFor(pluginId).selection = copySelection(selection);
	}

	getSelection(pluginId: string): SpatialSelection | null {
		return this.#selections.get(pluginId)?.selection ?? null;
	}

	setSelectionMode(pluginId: string, mode: SelectionMode): void {
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
		void point;
		return [];
	}

	featureForElement(element: Element): FeatureHit | null {
		void element;
		return null;
	}

	focusFeature(refKey: string): void {
		this.#focusedKey = refKey;
		const gl = this.#gl;
		if (!gl) return;
		const item = untrack(() => this.plugins)
			.flatMap((p) => p.features?.() ?? [])
			.find((f) => f.refKey === refKey);
		if (!item) return;
		gl.easeTo({ center: item.lngLat, ...(prefersReducedMotion() && { duration: 0 }) });
	}

	attach(gl: GlMapLike): void {
		this.#assertAlive();
		if (this.#gl === gl) return;
		if (this.#gl) this.detach();
		this.#gl = gl;
		this.#host.attach(gl);
		this.basemap.attach(gl, () => this.#host.restyle());
		this.#attached = true;
	}

	detach(): void {
		if (!this.#gl) return;
		this.basemap.detach();
		this.#host.detach();
		this.#gl = null;
		this.#attached = false;
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
		this.#destroyed = true;
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
