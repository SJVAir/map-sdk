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
}

/** What is under one point. */
interface Lookup {
	hits: FeatureHit[];
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
}

/**
 * Routes click and hover events on plugin layers to feature hits. One per map.
 *
 * Listens on the map itself (`click`, `mousemove`, `mouseout`) and queries only the registered
 * layers, so registrations can come and go without re-binding listeners. Layers nobody registered
 * are never hit. A blocking layer (e.g. a cluster bubble, which zooms instead) is never hit either,
 * but when it is topmost at a point nothing beneath it is hit or hovered.
 */
export class InteractionRouter {
	// Bookkeeping only; nothing reads these reactively.
	/* eslint-disable svelte/prefer-svelte-reactivity */
	#registrations = new Set<Registration>();
	#pickHandlers = new Set<(e: ClickEvent) => void>();
	/* eslint-enable svelte/prefer-svelte-reactivity */
	#gl: GlMapLike | null = null;
	#canvas: HTMLCanvasElement | null = null;
	/**
	 * The `pointerType` of the latest `pointerdown` on the canvas, for clicks whose original event
	 * has none (Safari before 17 dispatches `click` as a `MouseEvent`). Cleared after each click.
	 */
	#lastPointerType: string | null = null;
	#hovered = $state.raw<Hovered | null>(null);

	/** The top hit under the pointer and where it is. Reactive, for the tooltip. */
	get hovered(): Hovered | null {
		return this.#hovered;
	}

	/** Records the layers whose features `toHit` turns into hits. Returns an unregister function. */
	register(
		pluginId: string,
		layerIds: string[],
		toHit: (props: Record<string, unknown>) => FeatureHit | null
	): () => void {
		return this.#add({ pluginId, layerIds: [...layerIds], toHit, blocking: false });
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
		onClick?: (feature: BlockingClick) => void
	): () => void {
		return this.#add({
			pluginId,
			layerIds: [...layerIds],
			toHit: toHover ?? (() => null),
			blocking: true,
			onClick
		});
	}

	#add(registration: Registration): () => void {
		const { pluginId } = registration;
		this.#registrations.add(registration);
		return () => {
			if (!this.#registrations.delete(registration)) return;
			if (this.#hovered?.hit.pluginId === pluginId) this.#hovered = null;
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
		this.#canvas = gl.getCanvas();
		this.#canvas.addEventListener("pointerdown", this.#onPointerDown);
	}

	/** Stops listening and clears `hovered`. */
	detach(): void {
		const gl = this.#gl;
		if (!gl) return;
		gl.off("click", this.#onClick);
		gl.off("mousemove", this.#onMove);
		gl.off("mouseout", this.#onOut);
		this.#canvas?.removeEventListener("pointerdown", this.#onPointerDown);
		this.#canvas = null;
		this.#lastPointerType = null;
		this.#gl = null;
		this.#hovered = null;
	}

	/**
	 * Hits under a canvas point, topmost first, de-duplicated by `refKey`. `[]` when detached or
	 * when a blocking layer is topmost.
	 */
	hitsAt(point: [number, number]): FeatureHit[] {
		const found = this.#lookup(point);
		return found.blocked ? [] : found.hits;
	}

	#lookup(point: [number, number]): Lookup {
		const none: Lookup = { hits: [], blocked: false, blocker: null, blockedBy: null };
		const gl = this.#gl;
		if (!gl) return none;
		// Locals for one lookup; nothing reads them reactively.
		/* eslint-disable svelte/prefer-svelte-reactivity */
		const byLayer = new Map<string, Registration>();
		for (const registration of this.#registrations) {
			for (const id of registration.layerIds) {
				// MapLibre errors on querying a missing layer (e.g. mid basemap change).
				if (!byLayer.has(id) && gl.getLayer(id)) byLayer.set(id, registration);
			}
		}
		if (byLayer.size === 0) return none;
		const hits: FeatureHit[] = [];
		const seen = new Set<string>();
		/* eslint-enable svelte/prefer-svelte-reactivity */
		const features = gl.queryRenderedFeatures(point, { layers: [...byLayer.keys()] });
		const top = features[0] && byLayer.get(features[0].layer.id);
		if (top?.blocking) {
			const properties = features[0].properties ?? {};
			const hit = top.toHit(properties);
			return {
				hits: [],
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
			hits.push({ ...hit, pluginId: registration.pluginId });
		}
		return { hits, blocked: false, blocker: null, blockedBy: null };
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

	#onPointerDown = (e: Event) => {
		this.#lastPointerType = (e as PointerEvent).pointerType || null;
	};

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
			return;
		}
		const { hits } = found;
		if (hits.length === 0) return;
		const o = e.originalEvent;
		const pointerType = o?.pointerType || recorded;
		const event: ClickEvent = {
			hits,
			additive: Boolean(o?.shiftKey || o?.metaKey || o?.ctrlKey || pointerType === "touch"),
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

	#onMove = (e: PointerEventLike) => {
		const found = this.#lookup([e.point.x, e.point.y]);
		const hit = found.blocked ? found.blocker : found.hits[0];
		this.#hovered = hit ? { hit, lngLat: [e.lngLat.lng, e.lngLat.lat] } : null;
	};

	#onOut = () => {
		this.#hovered = null;
	};
}
