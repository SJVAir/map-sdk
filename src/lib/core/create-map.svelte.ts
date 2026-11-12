import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { createDefaultFormat, type FormatProvider } from "../data/format.js";
import { defaultMessages, type MessageProvider } from "../data/messages.js";
import { createDefaultMetadata, type MetadataProvider } from "../data/metadata.js";
import { applyPick, selectionKeys, toggleInSelection } from "../data/selection.js";
import type { FeatureRef, SelectionMode, SpatialSelection } from "../data/types.js";
import { BasemapState, type BasemapConfig } from "./basemap.svelte.js";
import type { GlMapLike } from "./gl.js";
import { InteractionRouter, type Hovered } from "./interactions.svelte.js";
import type { ClickEvent, FeatureHit, FeatureListItem, MapPlugin } from "./plugin.js";
import { PluginHost } from "./plugin-host.svelte.js";
import { intersectsBounds, shapeAnchor } from "./shape-view.js";

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
	/** Default `"mercator"`. `"globe"` draws the map on a globe when zoomed out. */
	projection?: "mercator" | "globe";
	/**
	 * Default `false`. A preset (monitor-map uses `{ preset: "milkyway" }`) draws space behind a
	 * globe.
	 */
	space?: false | { preset: string };
	/**
	 * Default `true`: MapTiler's own default. `false` turns off MapTiler's telemetry (a usage
	 * report of the SDK version, the API key, and the session id, sent about 2 s after each map is
	 * created) before the GL map is created. It is a page-wide setting in MapTiler's SDK, so once
	 * one map turns it off it stays off for every map on the page. MapTiler's session id (`mtsid`)
	 * stays on: MapTiler bills SDK maps by session, and its tile cache needs sessions.
	 */
	telemetry?: boolean;
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
	/**
	 * `"click"` (default): today's rules (a click selects; Shift/⌘/Ctrl or a tap adds in
	 * `"multiple"` mode). `"modifier"`: a plain click or tap only pins the card (use it with
	 * `MapView`'s `card`), and Shift/⌘/Ctrl-click, or the list's Space or Shift+Enter, toggles the
	 * feature in the selection.
	 */
	pickWith?: "click" | "modifier";
	/**
	 * Called before a user's pick (a click, a list pick, or the card's `toggle`) changes the
	 * selection, with the selection it would produce. `true` lets it through; a string refuses it
	 * and is the message the map shows (`MapContext.notice`). Not called for `setSelection` or the
	 * selection bar's Clear.
	 */
	canSelect?(next: SpatialSelection | null, ref: FeatureRef): true | string;
}

export type FeatureClickHandler = (e: {
	pluginId: string;
	ref: FeatureRef;
	/**
	 * The click point. For a pick in the feature list, where the item's tooltip pins: its position,
	 * or for a shape whose label point is off-screen, a point of the shape in view.
	 */
	lngLat: [number, number];
	/**
	 * The feature's source properties, from its plugin's `properties()` (e.g. a school's `source`
	 * and `external_id`); absent when the plugin gives none.
	 */
	properties?: Readonly<Record<string, unknown>>;
}) => void;

/** Where a camera move ends up. `zoom` wins over `minZoom`. */
export interface CameraTarget {
	center: [number, number];
	zoom?: number;
	/** Zoom to at least this: the move's zoom is `max(current zoom, minZoom)`. */
	minZoom?: number;
}

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
	 * Reactive. True once the attached map's style has loaded, the map has gone idle for the
	 * first time, and any queued plugin setups have run; false again on `detach()` and while a
	 * basemap switch reloads the style. Adding a plugin to a ready map leaves it true. A load
	 * screen can wait for it.
	 */
	readonly ready: boolean;
	/**
	 * Reactive. The attached GL map, or `null`. For markers and popups only (see `maptilerMap`);
	 * never add sources or layers through it.
	 */
	readonly gl: GlMapLike | null;
	/**
	 * @internal For `MapView` only; hosts never call it. Marks the attached map ready. Does
	 * nothing while detached.
	 */
	markReady(): void;
	/**
	 * Adds a plugin on top, or below `options.before`. Throws if a plugin with the same id is
	 * already added, if `before` names no added plugin, if the same plugin object is set up on
	 * another map (create one plugin per map), or after `destroy()`.
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
	 * Reactive. The feature whose reading card is pinned, and where, while `MapView`'s `card` is
	 * on; `null` otherwise. A click on a feature pins it (selection and `featureclick` are
	 * unchanged), focusing a feature-list row pins that row's feature, and a click on nothing (or
	 * on a cluster bubble or a feature without a hover card) unpins.
	 */
	readonly pinned: Hovered | null;
	/** Reactive. The plugin's `pickWith`: `"click"` for an unknown plugin. */
	getPickWith(pluginId: string): "click" | "modifier";
	/**
	 * A user's toggle of `ref` (the card's Select/Remove): the modifier-click rule, with the
	 * plugin's `canSelect` and `onselectionchange`, in either `pickWith` mode.
	 */
	togglePick(pluginId: string, ref: FeatureRef): void;
	/**
	 * Reactive. The latest refused pick's message; `id` grows with each refusal, so the same
	 * message twice is announced again. Cleared by the next pick, `clearNotice()`, and detach.
	 */
	readonly notice: { message: string; id: number } | null;
	/** @internal For `PickNotice`: clears the notice. */
	clearNotice(): void;
	/** Closes the pinned card. Does nothing when nothing is pinned. */
	unpin(): void;
	/** @internal For `MapView` only: turns pinning on or off. Off also unpins. */
	setCardEnabled(on: boolean): void;
	/**
	 * Marks the feature focused and pans to it (no animation under reduced motion): the item in
	 * `pluginId`'s features when given, else the first plugin listing `refKey`. `null` clears the
	 * focus without moving the camera. Sets `focusedPluginId` to `pluginId` (or `null`). The pan
	 * centers the feature in the part of the map the feature list panel leaves clear.
	 */
	focusFeature(refKey: string | null, pluginId?: string): void;
	/**
	 * Eases the camera to `target` (no animation under reduced motion). Does nothing while
	 * detached.
	 */
	easeTo(target: CameraTarget): void;
	/** Like `easeTo`, with a flying animation. */
	flyTo(target: CameraTarget): void;
	/**
	 * Fits the camera to `bounds` (no animation under reduced motion). Does nothing while
	 * detached.
	 */
	fitBounds(bounds: Bounds, options?: { padding?: number; maxZoom?: number }): void;
	/** Reactive. */
	readonly focusedKey: string | null;
	/** Reactive. The plugin `focusFeature` was given with `focusedKey`, or `null`. */
	readonly focusedPluginId: string | null;
	/**
	 * Reactive. Where the focused feature's tooltip pins, set by `focusFeature` (`null` without
	 * focus): its `lngLat`, or for a shape that overlaps the view with its `lngLat` off-screen, a
	 * point of the shape in the part of the view the list panel leaves clear. Fixed at focus
	 * time, so it stays on the feature if the map then moves.
	 */
	readonly focusedAnchor: [number, number] | null;
	/**
	 * Where `item`'s tooltip pins in the current view, without moving the camera: its `lngLat`,
	 * or for a shape (`geometry`) with its `lngLat` off-screen, a point of the shape in view.
	 */
	anchorFor(item: FeatureListItem): [number, number];
	/** For MapView only: uses `gl` from now on. */
	attach(gl: GlMapLike): void;
	/** For MapView only: stops using the current GL map. */
	detach(): void;
	/**
	 * For MapView only: how many pixels at the map's left or right edge (`side`, default left)
	 * the open feature list panel covers (0 when closed), which `focusFeature` pans clear of.
	 */
	setListInset(width: number, side?: "left" | "right"): void;
	/** For MapView only: records the camera and bounds after a move. */
	updateView(camera: CameraState, bounds: Bounds): void;
	/**
	 * For MapView only: the host's theme changed, so plugins set up again and re-read the theme
	 * colors they bake into paint and images. Does nothing while detached. Sets plugins up
	 * synchronously, so never call it from inside an effect (see `PluginHost`).
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
	pickWith = $state<"click" | "modifier">("click");
	canSelect: PluginOptions["canSelect"];
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

const inRect = (p: [number, number], b: Bounds) =>
	p[0] >= b.west && p[0] <= b.east && p[1] >= b.south && p[1] <= b.north;

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
	#ready = $state(false);
	/** `markReady` came while plugin setups were queued; the queued run sets `ready`. */
	#readyRequested = false;
	#glState = $state.raw<GlMapLike | null>(null);
	#focusedKey = $state<string | null>(null);
	#focusedPluginId = $state<string | null>(null);
	#focusedAnchor = $state.raw<[number, number] | null>(null);
	#pinned = $state.raw<Hovered | null>(null);
	#notice = $state.raw<{ message: string; id: number } | null>(null);
	#noticeCount = 0;
	#cardEnabled = false;
	#selections = new SvelteMap<string, PluginSelection>();
	#featureClickHandlers = new Set<FeatureClickHandler>();
	#router = new InteractionRouter();
	#host: PluginHost;
	#gl: GlMapLike | null = null;
	#destroyed = false;
	#listInset = 0;
	#listInsetSide: "left" | "right" = "left";
	/** An animated ease that `focusFeature` started is still running (cleared on `moveend`). */
	#focusEasing = false;
	#onMoveEnd = () => {
		this.#focusEasing = false;
	};

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
			selectedKeys: (pluginId) => selectionKeys(this.getSelection(pluginId)),
			onSettled: () => {
				// A setup that added a plugin queued another run; that run settles it.
				if (this.#host.pending) return;
				if (this.#readyRequested && this.#gl) this.#ready = true;
				this.#readyRequested = false;
			}
		});
		this.#router.onPick((e) => this.#pick(e));
		this.#router.onMiss(() => this.unpin());
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

	get ready(): boolean {
		return this.#ready;
	}

	get gl(): GlMapLike | null {
		return this.#glState;
	}

	markReady(): void {
		if (!this.#gl) return;
		if (this.#host.pending) this.#readyRequested = true;
		else this.#ready = true;
	}

	get focusedKey(): string | null {
		return this.#focusedKey;
	}

	get focusedPluginId(): string | null {
		return this.#focusedPluginId;
	}

	get focusedAnchor(): [number, number] | null {
		return this.#focusedAnchor;
	}

	get hovered(): Hovered | null {
		return this.#router.hovered;
	}

	get pinned(): Hovered | null {
		return this.#pinned;
	}

	get notice(): { message: string; id: number } | null {
		return this.#notice;
	}

	clearNotice(): void {
		if (untrack(() => this.#notice) !== null) this.#notice = null;
	}

	getPickWith(pluginId: string): "click" | "modifier" {
		return this.#selections.get(pluginId)?.pickWith ?? "click";
	}

	togglePick(pluginId: string, ref: FeatureRef): void {
		if (this.#destroyed) return;
		this.#applyPick(pluginId, ref, { toggle: true });
	}

	unpin(): void {
		if (untrack(() => this.#pinned) !== null) this.#pinned = null;
	}

	setCardEnabled(on: boolean): void {
		this.#cardEnabled = on;
		if (!on) this.unpin();
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
		untrack(() => {
			state.pickWith = options.pickWith ?? previous?.pickWith ?? "click";
		});
		state.canSelect = options.canSelect ?? previous?.canSelect;
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
		if (untrack(() => this.#pinned)?.hit.pluginId === id) this.unpin();
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
		const { item } = found;
		// Where the row's tooltip pins: the focused anchor for the focused row, else a point of a
		// shape in view (a point's own position for points and on-screen label points).
		const focused =
			untrack(() => this.#focusedKey) === refKey &&
			(untrack(() => this.#focusedPluginId) ?? pluginId) === pluginId;
		const anchor = (focused && untrack(() => this.#focusedAnchor)) || this.anchorFor(item);
		this.#emitClick(pluginId, item.ref, anchor, refKey);
		if (item.selectable) this.#applyPick(pluginId, item.ref, { additive, modifier: additive });
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
		this.#focusedAnchor = null;
		const gl = this.#gl;
		if (!gl || refKey === null) return;
		const found = untrack(() => this.#findItem(refKey, pluginId));
		if (!found) return;
		const { plugin, item } = found;
		const place = this.#placeFor(item, gl);
		this.#focusedAnchor = place.anchor;
		if (this.#cardEnabled) {
			this.#pinned = {
				hit: { pluginId: plugin.id, ref: item.ref, refKey: item.refKey, name: item.name },
				lngLat: place.anchor
			};
		}
		if (!place.pan) {
			// Stays where it is now: an earlier focus's ease that is still running stops here.
			// With nothing running, no move at all.
			if (this.#focusEasing) {
				const { lng, lat } = gl.getCenter();
				gl.easeTo({ center: [lng, lat], duration: 0 });
				this.#focusEasing = false;
			}
			return;
		}
		const reduce = prefersReducedMotion();
		gl.easeTo({
			center: place.anchor,
			// The middle of the part the panel leaves clear. An offset, not padding: MapLibre keeps
			// padding for later moves (zooms, the reported center), an offset applies to this one.
			...(this.#listInset > 0 && { offset: [this.#listOffsetX(), 0] as [number, number] }),
			...(reduce && { duration: 0 })
		});
		// Set after the call: stopping an earlier move fires its `moveend` inside `easeTo`.
		this.#focusEasing = !reduce;
	}

	anchorFor(item: FeatureListItem): [number, number] {
		const gl = this.#gl;
		if (!gl || !item.geometry) return item.lngLat;
		const { live, clear, liveCenter, clearCenter } = this.#views(gl);
		if (inRect(item.lngLat, live) || !intersectsBounds(item, live)) return item.lngLat;
		return (
			shapeAnchor(item.geometry, clear, clearCenter) ??
			shapeAnchor(item.geometry, live, liveCenter) ??
			item.lngLat
		);
	}

	/** The live view, and the part of it the list panel leaves clear, with their centers. */
	#views(gl: GlMapLike) {
		const b = gl.getBounds();
		const live: Bounds = {
			west: b.getWest(),
			south: b.getSouth(),
			east: b.getEast(),
			north: b.getNorth()
		};
		const center = gl.getCenter();
		const width = untrack(() => gl.getCanvas().clientWidth) || 0;
		const share = width > 0 ? Math.min(Math.max(this.#listInset / width, 0), 0.99) : 0;
		const cut = share * (live.east - live.west);
		const clear =
			this.#listInsetSide === "left"
				? { ...live, west: live.west + cut }
				: { ...live, east: live.east - cut };
		return {
			live,
			clear,
			liveCenter: [center.lng, center.lat] as [number, number],
			clearCenter: [(clear.west + clear.east) / 2, center.lat] as [number, number]
		};
	}

	/**
	 * Where focus puts `item`: `pan: false` keeps the camera (a shape in view whose `lngLat` is
	 * off-screen, with a point in the clear part); otherwise ease to center `anchor`.
	 */
	#placeFor(item: FeatureListItem, gl: GlMapLike): { anchor: [number, number]; pan: boolean } {
		const { geometry, lngLat } = item;
		if (!geometry) return { anchor: lngLat, pan: true };
		const { live, clear, liveCenter, clearCenter } = this.#views(gl);
		if (inRect(lngLat, live)) return { anchor: lngLat, pan: true };
		if (intersectsBounds(item, live)) {
			const inClear = shapeAnchor(geometry, clear, clearCenter);
			if (inClear) return { anchor: inClear, pan: false };
			const inLive = shapeAnchor(geometry, live, liveCenter);
			if (inLive) return { anchor: inLive, pan: true };
		}
		const settled = untrack(() => this.#bounds);
		if (settled && intersectsBounds(item, settled)) {
			const middle: [number, number] = [
				(settled.west + settled.east) / 2,
				(settled.south + settled.north) / 2
			];
			const inSettled = shapeAnchor(geometry, settled, middle);
			if (inSettled) return { anchor: inSettled, pan: true };
		}
		return { anchor: lngLat, pan: true };
	}

	#cameraOptions(target: CameraTarget, gl: GlMapLike) {
		const zoom =
			target.zoom ??
			(target.minZoom === undefined ? undefined : Math.max(gl.getZoom(), target.minZoom));
		return {
			center: target.center,
			...(zoom !== undefined && { zoom }),
			...(prefersReducedMotion() && { duration: 0 })
		};
	}

	easeTo(target: CameraTarget): void {
		const gl = this.#destroyed ? null : this.#gl;
		if (gl) gl.easeTo(this.#cameraOptions(target, gl));
	}

	flyTo(target: CameraTarget): void {
		const gl = this.#destroyed ? null : this.#gl;
		if (gl) gl.flyTo(this.#cameraOptions(target, gl));
	}

	fitBounds(bounds: Bounds, options: { padding?: number; maxZoom?: number } = {}): void {
		const gl = this.#destroyed ? null : this.#gl;
		if (!gl) return;
		gl.fitBounds(
			[
				[bounds.west, bounds.south],
				[bounds.east, bounds.north]
			],
			{
				...(options.padding !== undefined && { padding: options.padding }),
				...(options.maxZoom !== undefined && { maxZoom: options.maxZoom }),
				...(prefersReducedMotion() && { duration: 0 })
			}
		);
	}

	attach(gl: GlMapLike): void {
		this.#assertAlive();
		if (this.#gl === gl) return;
		if (this.#gl) this.detach();
		this.#gl = gl;
		this.#glState = gl;
		this.#host.attach(gl);
		this.#router.attach(gl);
		gl.on("moveend", this.#onMoveEnd);
		this.basemap.attach(
			gl,
			// Called from style.load: the style is loaded, though its tiles may not be.
			() => this.#host.restyle(true),
			() => {
				this.#ready = false;
				this.#readyRequested = false;
				this.#host.suspend();
			}
		);
		this.#attached = true;
	}

	detach(): void {
		if (!this.#gl) return;
		this.#gl.off("moveend", this.#onMoveEnd);
		this.#focusEasing = false;
		this.unpin();
		this.clearNotice();
		this.#router.detach();
		this.basemap.detach();
		this.#host.detach();
		this.#gl = null;
		this.#glState = null;
		this.#attached = false;
		this.#ready = false;
		this.#readyRequested = false;
	}

	themeChanged(): void {
		if (this.#gl) this.#host.restyle();
	}

	/** Half the panel's width, toward the part of the map it leaves clear. */
	#listOffsetX(): number {
		return ((this.#listInsetSide === "left" ? 1 : -1) * this.#listInset) / 2;
	}

	setListInset(width: number, side: "left" | "right" = "left"): void {
		this.#listInset = Math.max(0, width);
		this.#listInsetSide = side;
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
		this.#focusedAnchor = null;
		this.#destroyed = true;
	}

	/** A click on a feature: report it, then apply it to the top hit's plugin's selection. */
	#pick(e: ClickEvent): void {
		if (this.#destroyed) return;
		const [hit] = e.hits;
		const { pluginId, ref } = hit;
		// A box-zoom Shift-click only counts for a plugin that asked for modifier picks.
		if (e.boxZoom && untrack(() => this.#selections.get(pluginId)?.pickWith) !== "modifier") {
			return;
		}
		this.#emitClick(pluginId, ref, e.lngLat, hit.refKey);
		this.#applyPick(pluginId, ref, { additive: e.additive, modifier: e.modifier });
		if (!this.#cardEnabled || this.#destroyed) return;
		// A feature with no hover card (e.g. a smoke plume) gets no pinned card either.
		const plugin = untrack(() => this.plugins).find((p) => p.id === pluginId);
		if (!plugin || plugin.hoverable === false) this.unpin();
		else this.#pinned = { hit, lngLat: e.lngLat };
	}

	#emitClick(pluginId: string, ref: FeatureRef, lngLat: [number, number], refKey: string): void {
		const plugin = untrack(() => this.plugins).find((p) => p.id === pluginId);
		const properties = untrack(() => plugin?.properties?.(refKey));
		const event = properties ? { pluginId, ref, lngLat, properties } : { pluginId, ref, lngLat };
		for (const handler of [...this.#featureClickHandlers]) {
			try {
				handler(event);
			} catch (error) {
				console.error("map-sdk: a featureclick handler failed", error);
			}
		}
	}

	/** The one place a user's pick (map click or list key) changes a plugin's selection. */
	/**
	 * The one place a user's pick (map click, list key, or the card's toggle) changes a plugin's
	 * selection: the plugin's `pickWith` rule, then its `canSelect`.
	 */
	#applyPick(
		pluginId: string,
		ref: FeatureRef,
		gesture: { additive?: boolean; modifier?: boolean; toggle?: boolean }
	): void {
		// A featureclick handler may have removed the plugin.
		const state = untrack(() => this.#selections.get(pluginId));
		if (!state) return;
		const current = untrack(() => state.selection);
		const mode = untrack(() => state.mode);
		let next: SpatialSelection | null;
		if (gesture.toggle) next = toggleInSelection(current, ref, mode);
		else if (untrack(() => state.pickWith) === "modifier") {
			// A plain click or tap only pins the card.
			next = gesture.modifier ? toggleInSelection(current, ref, mode) : current;
		} else next = applyPick(current, ref, mode, { additive: gesture.additive ?? false });
		if (sameSelection(current, next)) {
			this.clearNotice();
			return;
		}
		if (state.canSelect) {
			let verdict: true | string;
			try {
				verdict = state.canSelect(copySelection(next), ref);
			} catch (error) {
				console.error("map-sdk: canSelect failed", error);
				return;
			}
			if (verdict !== true) {
				// An empty (or, from untyped JS, false) verdict refuses quietly.
				if (typeof verdict === "string" && verdict !== "") {
					this.#notice = { message: verdict, id: ++this.#noticeCount };
				}
				return;
			}
		}
		this.clearNotice();
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
