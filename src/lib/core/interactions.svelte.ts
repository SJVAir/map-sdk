import { SvelteMap } from "svelte/reactivity";
import { isTouchClick } from "./click-pointer.js";
import type { GlMapLike } from "./gl.js";
import type { BlockingClick, ClickEvent, FeatureHit } from "./plugin.js";

interface Registration {
	pluginId: string;
	layerIds: string[];
	toHit: (props: Record<string, unknown>) => FeatureHit | null;
	/** Hits nothing itself, and hides what is beneath it; `toHit` gives only its hover hit. */
	blocking: boolean;
	/** For a blocking layer: called for a click where it is topmost. */
	onClick?: (feature: BlockingClick) => void;
	/** The plugin's `hoverPriority`. */
	priority: number;
	/** False: its features are left out of the hover and cursor, as if not rendered. */
	hoverable: boolean;
}

/** What is under one point. */
interface Lookup {
	hits: FeatureHit[];
	/**
	 * The hit hover shows: the highest plugin priority among `hits`, the topmost on a tie. When
	 * blocked, a feature beneath whose plugin outranks the blocking one (e.g. a collocation site
	 * under a monitor cluster bubble); otherwise null and the blocker's own hit shows.
	 */
	hover: FeatureHit | null;
	/** True when the topmost feature is on a blocking layer: nothing beneath is hit. */
	blocked: boolean;
	/** The blocking layer's hover hit, if it gives one. */
	blocker: FeatureHit | null;
	/** The blocking registration and its topmost feature. */
	blockedBy: { registration: Registration; feature: BlockingClick } | null;
}

/** The parts of a MapLibre `MapMouseEvent` the router reads. */
interface PointerEventLike {
	point: { x: number; y: number };
	lngLat: { lng: number; lat: number };
	originalEvent?: {
		shiftKey?: boolean;
		metaKey?: boolean;
		ctrlKey?: boolean;
		/** Set when the browser dispatches the click as a `PointerEvent`. */
		pointerType?: string;
	};
}

export interface Hovered {
	hit: FeatureHit;
	lngLat: [number, number];
	/**
	 * Set by `MapContext.pin` when the card stays where the open card was (that point lies on the
	 * new feature's shape): the card is drawn at `lngLat`, not at the feature's own point.
	 */
	inPlace?: true;
}

/**
 * A plugin's own topmost hit under the pointer (`InteractionRouter.hoverOf`). `lngLat` is where
 * the pointer entered the feature, not where it is now.
 */
export interface OwnHover extends Hovered {
	/** The move came from touch (the browser's emulated mouse events after a tap). */
	touch: boolean;
}

/**
 * Routes click and hover events on plugin layers to feature hits. One per map.
 *
 * Listens on the map itself (`click`, `mousemove`, `mouseout`) and queries only the registered
 * layers, so registrations can come and go without re-binding listeners. Layers nobody registered
 * are never hit. A blocking layer (e.g. a cluster bubble, which zooms instead) is never hit either,
 * and when it is topmost at a point nothing beneath it is hit; only a feature whose plugin
 * outranks it in `hoverPriority` is hovered through it. A non-hoverable plugin's features (e.g.
 * smoke plumes) are left out of the hover and cursor as if they weren't rendered, but are still
 * clicked and returned by lookups.
 */
export class InteractionRouter {
	// Bookkeeping only; nothing reads these reactively.
	/* eslint-disable svelte/prefer-svelte-reactivity */
	#registrations = new Set<Registration>();
	#pickHandlers = new Set<(e: ClickEvent) => void>();
	#missHandlers = new Set<() => void>();
	/* eslint-enable svelte/prefer-svelte-reactivity */
	#gl: GlMapLike | null = null;
	#canvas: HTMLCanvasElement | null = null;
	/**
	 * The `pointerType` of the latest `pointerdown` in the canvas's container, for `isTouchClick`.
	 * Cleared after each click and on `pointercancel`.
	 */
	#lastPointerType: string | null = null;
	#hovered = $state.raw<Hovered | null>(null);
	/** Each plugin's own topmost hit under the pointer; written only when it changes. */
	#own = new SvelteMap<string, OwnHover>();
	/**
	 * The `pointerType` of the latest `pointerdown` or `pointermove` on the canvas, for marking
	 * hover from touch. Unlike `#lastPointerType`, a click doesn't clear it.
	 */
	#movePointerType: string | null = null;
	/** Plugins whose own hover someone watches (`watchHover`), with how many watchers. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not reactive
	#watched = new Map<string, number>();
	/** Where pointer types are read from: the canvas's container, so DOM markers count too. */
	#pointerRoot: EventTarget | null = null;
	/** Whether the canvas cursor is set to a pointer. */
	#pointer = false;

	/** The top hit under the pointer and where it is. Reactive, for the tooltip. */
	get hovered(): Hovered | null {
		return this.#hovered;
	}

	/**
	 * A watched plugin's own topmost hit under the pointer (see `watchHover`), whatever lies on top
	 * of it (another plugin's feature, a blocking layer), hoverable or not, and where the pointer
	 * entered it. Reactive; changes only when the hit's `refKey` or `touch` changes. Null off its
	 * features, on `mouseout`, once detached, and for a plugin nobody watches.
	 */
	hoverOf(pluginId: string): OwnHover | null {
		return this.#own.get(pluginId) ?? null;
	}

	/**
	 * Starts keeping `hoverOf(pluginId)`; until someone watches a plugin, moves cost what they did
	 * before (only hoverable layers are queried). Returns the unwatch.
	 */
	watchHover(pluginId: string): () => void {
		this.#watched.set(pluginId, (this.#watched.get(pluginId) ?? 0) + 1);
		let done = false;
		return () => {
			if (done) return;
			done = true;
			const left = (this.#watched.get(pluginId) ?? 1) - 1;
			if (left > 0) this.#watched.set(pluginId, left);
			else {
				this.#watched.delete(pluginId);
				this.#own.delete(pluginId);
			}
		};
	}

	/** Records the layers whose features `toHit` turns into hits. Returns an unregister function. */
	register(
		pluginId: string,
		layerIds: string[],
		toHit: (props: Record<string, unknown>) => FeatureHit | null,
		priority = 0,
		hoverable = true
	): () => void {
		return this.#add({
			pluginId,
			layerIds: [...layerIds],
			toHit,
			blocking: false,
			priority,
			hoverable
		});
	}

	/**
	 * Records layers that hide what is beneath them: when one is topmost at a point, clicks pick
	 * nothing (calling `onClick` with that feature instead) and the hover is `toHover`'s hit for
	 * it (or nothing). `toHover` must have no side effects: lookups call it too. Returns an
	 * unregister function.
	 */
	registerBlocking(
		pluginId: string,
		layerIds: string[],
		toHover?: (props: Record<string, unknown>) => FeatureHit | null,
		onClick?: (feature: BlockingClick) => void,
		priority = 0,
		hoverable = true
	): () => void {
		return this.#add({
			pluginId,
			layerIds: [...layerIds],
			toHit: toHover ?? (() => null),
			blocking: true,
			onClick,
			priority,
			hoverable
		});
	}

	#add(registration: Registration): () => void {
		const { pluginId } = registration;
		this.#registrations.add(registration);
		return () => {
			if (!this.#registrations.delete(registration)) return;
			if (this.#hovered?.hit.pluginId === pluginId) this.#hovered = null;
			if (![...this.#registrations].some((r) => r.pluginId === pluginId)) {
				this.#own.delete(pluginId);
			}
			// The pointer may have been over this plugin; the next move sets it again.
			this.#setPointer(false);
		};
	}

	/** Listens to `gl` from now on. */
	attach(gl: GlMapLike): void {
		if (this.#gl === gl) return;
		this.detach();
		this.#gl = gl;
		gl.on("click", this.#onClick);
		gl.on("mousemove", this.#onMove);
		gl.on("mouseout", this.#onOut);
		gl.on("boxzoomstart", this.#onBoxZoomStart);
		gl.on("boxzoomcancel", this.#onBoxZoomCancel);
		this.#canvas = gl.getCanvas();
		this.#pointerRoot = this.#canvas.parentElement ?? this.#canvas;
		// The canvas's container, not the canvas: MapLibre fires a map click for a press on anything
		// in it (a host's Marker over a feature, too).
		this.#pointerRoot.addEventListener("pointerdown", this.#onPointerDown);
		this.#pointerRoot.addEventListener("pointercancel", this.#onPointerCancel);
		this.#pointerRoot.addEventListener("pointerdown", this.#onPointerType);
		this.#pointerRoot.addEventListener("pointermove", this.#onPointerType);
	}

	/** Stops listening and clears `hovered`. */
	detach(): void {
		const gl = this.#gl;
		if (!gl) return;
		gl.off("click", this.#onClick);
		gl.off("mousemove", this.#onMove);
		gl.off("mouseout", this.#onOut);
		gl.off("boxzoomstart", this.#onBoxZoomStart);
		gl.off("boxzoomcancel", this.#onBoxZoomCancel);
		this.#boxDrawn = false;
		this.#pointerRoot?.removeEventListener("pointerdown", this.#onPointerDown);
		this.#pointerRoot?.removeEventListener("pointercancel", this.#onPointerCancel);
		this.#pointerRoot?.removeEventListener("pointerdown", this.#onPointerType);
		this.#pointerRoot?.removeEventListener("pointermove", this.#onPointerType);
		this.#pointerRoot = null;
		this.#setPointer(false);
		this.#canvas = null;
		this.#lastPointerType = null;
		this.#movePointerType = null;
		this.#gl = null;
		this.#hovered = null;
		this.#own.clear();
	}

	/**
	 * Hits under a canvas point, topmost first, de-duplicated by `refKey`. `[]` when detached or
	 * when a blocking layer is topmost.
	 */
	hitsAt(point: [number, number]): FeatureHit[] {
		const found = this.#lookup(point);
		return found.blocked ? [] : found.hits;
	}

	/**
	 * What is under one point; with `forHover`, non-hoverable features are left out first.
	 * `features`: what a query of every registered layer at `point` returned, to reuse instead of
	 * querying again (filtered to this lookup's layers).
	 */
	#lookup(
		point: [number, number],
		forHover = false,
		features?: ReturnType<GlMapLike["queryRenderedFeatures"]>
	): Lookup {
		const none: Lookup = { hits: [], hover: null, blocked: false, blocker: null, blockedBy: null };
		const gl = this.#gl;
		if (!gl) return none;
		// Locals for one lookup; nothing reads them reactively.
		/* eslint-disable svelte/prefer-svelte-reactivity */
		const byLayer = new Map<string, Registration>();
		for (const registration of this.#registrations) {
			if (forHover && !registration.hoverable) continue;
			for (const id of registration.layerIds) {
				// MapLibre errors on querying a missing layer (e.g. mid basemap change).
				if (!byLayer.has(id) && gl.getLayer(id)) byLayer.set(id, registration);
			}
		}
		if (byLayer.size === 0) return none;
		const hits: FeatureHit[] = [];
		let hover: FeatureHit | null = null;
		let hoverPriority = -Infinity;
		const seen = new Set<string>();
		/* eslint-enable svelte/prefer-svelte-reactivity */
		features = features
			? features.filter((f) => byLayer.has(f.layer.id))
			: gl.queryRenderedFeatures(point, { layers: [...byLayer.keys()] });
		const top = features[0] && byLayer.get(features[0].layer.id);
		if (top?.blocking) {
			const properties = features[0].properties ?? {};
			const hit = top.toHit(properties);
			// Clicks stay blocked, but the hover goes to the highest-priority feature beneath that
			// outranks the blocking plugin.
			let beneath: FeatureHit | null = null;
			let beneathPriority = top.priority;
			for (const feature of features.slice(1)) {
				const registration = byLayer.get(feature.layer.id);
				if (!registration || registration.blocking) continue;
				if (registration.priority <= beneathPriority) continue;
				const below = registration.toHit(feature.properties ?? {});
				if (!below) continue;
				beneath = { ...below, pluginId: registration.pluginId };
				beneathPriority = registration.priority;
			}
			return {
				hits: [],
				hover: beneath,
				blocked: true,
				blocker: hit && { ...hit, pluginId: top.pluginId },
				blockedBy: { registration: top, feature: { properties, geometry: features[0].geometry } }
			};
		}
		for (const feature of features) {
			const registration = byLayer.get(feature.layer.id);
			if (!registration || registration.blocking) continue;
			const hit = registration.toHit(feature.properties ?? {});
			if (!hit || seen.has(hit.refKey)) continue;
			seen.add(hit.refKey);
			const withPlugin = { ...hit, pluginId: registration.pluginId };
			hits.push(withPlugin);
			// Strictly greater, so a tie keeps the topmost.
			if (registration.priority > hoverPriority) {
				hover = withPlugin;
				hoverPriority = registration.priority;
			}
		}
		return { hits, hover, blocked: false, blocker: null, blockedBy: null };
	}

	/**
	 * Called for every click with at least one hit. `additive` is true for a shift, ⌘, or Ctrl
	 * click, or a touch tap; selection rules decide what it means for the plugin's mode.
	 */
	onPick(handler: (e: ClickEvent) => void): () => void {
		this.#pickHandlers.add(handler);
		return () => {
			this.#pickHandlers.delete(handler);
		};
	}

	/**
	 * Called for a click that picks nothing: one with no hits, or one on a blocking layer (after
	 * that layer's own click handler). Returns an unsubscribe function.
	 */
	onMiss(handler: () => void): () => void {
		this.#missHandlers.add(handler);
		return () => {
			this.#missHandlers.delete(handler);
		};
	}

	#emitMiss(): void {
		for (const handler of [...this.#missHandlers]) {
			try {
				handler();
			} catch (error) {
				console.error("map-sdk: a miss handler failed", error);
			}
		}
	}

	#onPointerDown = (e: Event) => {
		this.#lastPointerType = (e as PointerEvent).pointerType || null;
	};

	#onPointerCancel = () => {
		this.#lastPointerType = null;
	};

	#onPointerType = (e: Event) => {
		this.#movePointerType = (e as PointerEvent).pointerType || null;
	};

	/**
	 * The layers under `point` a move needs, topmost first, and which registration owns each:
	 * hoverable ones, plus every layer of a watched plugin.
	 */
	#queryAll(point: [number, number]) {
		const gl = this.#gl;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local for one move
		const byLayer = new Map<string, Registration>();
		if (!gl) return { features: [], byLayer };
		for (const registration of this.#registrations) {
			if (!registration.hoverable && !this.#watched.has(registration.pluginId)) continue;
			for (const id of registration.layerIds) {
				if (!byLayer.has(id) && gl.getLayer(id)) byLayer.set(id, registration);
			}
		}
		const features =
			byLayer.size === 0 ? [] : gl.queryRenderedFeatures(point, { layers: [...byLayer.keys()] });
		return { features, byLayer };
	}

	/** Each plugin's topmost non-blocking hit in `features`; writes only what changed. */
	#updateOwn(
		features: ReturnType<GlMapLike["queryRenderedFeatures"]>,
		byLayer: Map<string, Registration>,
		lngLat: [number, number]
	): void {
		const touch = this.#movePointerType === "touch";
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local for one move
		const next = new Map<string, OwnHover>();
		for (const feature of features) {
			const registration = byLayer.get(feature.layer.id);
			if (!registration || registration.blocking || next.has(registration.pluginId)) continue;
			if (!this.#watched.has(registration.pluginId)) continue;
			const hit = registration.toHit(feature.properties ?? {});
			if (!hit) continue;
			next.set(registration.pluginId, {
				hit: { ...hit, pluginId: registration.pluginId },
				lngLat,
				touch
			});
		}
		for (const key of [...this.#own.keys()]) if (!next.has(key)) this.#own.delete(key);
		for (const [key, own] of next) {
			const was = this.#own.get(key);
			if (!was || was.hit.refKey !== own.hit.refKey || was.touch !== own.touch) {
				this.#own.set(key, own);
			}
		}
	}

	#onClick = (e: PointerEventLike) => {
		const recorded = this.#lastPointerType;
		this.#lastPointerType = null;
		const found = this.#lookup([e.point.x, e.point.y]);
		if (found.blockedBy) {
			const { registration, feature } = found.blockedBy;
			try {
				registration.onClick?.(feature);
			} catch (error) {
				console.error("map-sdk: a blocking layer's click handler failed", error);
			}
			this.#emitMiss();
			return;
		}
		const { hits } = found;
		if (hits.length === 0) {
			this.#emitMiss();
			return;
		}
		const o = e.originalEvent;
		const modifier = Boolean(o?.shiftKey || o?.metaKey || o?.ctrlKey);
		const touch = isTouchClick(o?.pointerType, recorded);
		const event: ClickEvent = {
			hits,
			additive: modifier || touch,
			modifier,
			touch,
			lngLat: [e.lngLat.lng, e.lngLat.lat]
		};
		for (const handler of [...this.#pickHandlers]) {
			try {
				handler(event);
			} catch (error) {
				console.error("map-sdk: a pick handler failed", error);
			}
		}
	};

	/**
	 * MapLibre's box zoom starts on a Shift press and, released in place, suppresses the click and
	 * fires `boxzoomcancel`. A release with a pointer position is reported as a Shift-click
	 * (`boxZoom: true`) to the pick handlers only: no miss, no blocking layer's click.
	 */
	/** A box was drawn since the Shift press: its cancel is a drag back to the start, not a click. */
	#boxDrawn = false;

	#onBoxZoomStart = () => {
		this.#boxDrawn = true;
	};

	#onBoxZoomCancel = (e: { originalEvent?: unknown }) => {
		const drawn = this.#boxDrawn;
		this.#boxDrawn = false;
		if (drawn) return;
		const o = e.originalEvent as
			| {
					clientX?: number;
					clientY?: number;
					shiftKey?: boolean;
					metaKey?: boolean;
					ctrlKey?: boolean;
			  }
			| undefined;
		const gl = this.#gl;
		if (!gl || typeof o?.clientX !== "number" || typeof o.clientY !== "number") return;
		const point = this.#canvasPoint(o.clientX, o.clientY);
		const found = this.#lookup(point);
		if (found.blockedBy || found.hits.length === 0) return;
		const { lng, lat } = gl.unproject(point);
		const event: ClickEvent = {
			hits: found.hits,
			additive: true,
			modifier: true,
			touch: false,
			boxZoom: true,
			lngLat: [lng, lat]
		};
		for (const handler of [...this.#pickHandlers]) {
			try {
				handler(event);
			} catch (error) {
				console.error("map-sdk: a pick handler failed", error);
			}
		}
	};

	/** A page position as a canvas pixel, as MapLibre's `DOM.mousePos` does (CSS scale included). */
	#canvasPoint(clientX: number, clientY: number): [number, number] {
		const canvas = this.#canvas;
		const rect = canvas?.getBoundingClientRect?.();
		if (!canvas || !rect) return [clientX, clientY];
		const scaleX = canvas.offsetWidth ? rect.width / canvas.offsetWidth : 1;
		const scaleY = canvas.offsetHeight ? rect.height / canvas.offsetHeight : 1;
		return [
			(clientX - rect.left) / scaleX - (canvas.clientLeft || 0),
			(clientY - rect.top) / scaleY - (canvas.clientTop || 0)
		];
	}

	#onMove = (e: PointerEventLike) => {
		const point: [number, number] = [e.point.x, e.point.y];
		const { features, byLayer } = this.#queryAll(point);
		this.#updateOwn(features, byLayer, [e.lngLat.lng, e.lngLat.lat]);
		const found = this.#lookup(point, true, features);
		const hit = found.blocked ? (found.hover ?? found.blocker) : found.hover;
		this.#hovered = hit ? { hit, lngLat: [e.lngLat.lng, e.lngLat.lat] } : null;
		this.#setPointer(found.blocked || hit !== null);
	};

	#onOut = () => {
		this.#hovered = null;
		this.#own.clear();
		this.#setPointer(false);
	};

	/** Sets the canvas cursor only when it changes, so the engine's own cursors are left alone. */
	#setPointer(on: boolean): void {
		if (on === this.#pointer) return;
		this.#pointer = on;
		if (this.#canvas) this.#canvas.style.cursor = on ? "pointer" : "";
	}
}
