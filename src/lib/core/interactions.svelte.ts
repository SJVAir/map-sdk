import type { GlMapLike } from "./gl.js";
import type { ClickEvent, FeatureHit } from "./plugin.js";

interface Registration {
	pluginId: string;
	layerIds: string[];
	toHit: (props: Record<string, unknown>) => FeatureHit | null;
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
 * (e.g. cluster bubbles, which zoom instead) are never hit.
 */
export class InteractionRouter {
	// Bookkeeping only; nothing reads these reactively.
	/* eslint-disable svelte/prefer-svelte-reactivity */
	#registrations = new Set<Registration>();
	#pickHandlers = new Set<(e: ClickEvent) => void>();
	/* eslint-enable svelte/prefer-svelte-reactivity */
	#gl: GlMapLike | null = null;
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
		const registration: Registration = { pluginId, layerIds: [...layerIds], toHit };
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
	}

	/** Stops listening and clears `hovered`. */
	detach(): void {
		const gl = this.#gl;
		if (!gl) return;
		gl.off("click", this.#onClick);
		gl.off("mousemove", this.#onMove);
		gl.off("mouseout", this.#onOut);
		this.#gl = null;
		this.#hovered = null;
	}

	/** Hits under a canvas point, topmost first, de-duplicated by `refKey`. `[]` when detached. */
	hitsAt(point: [number, number]): FeatureHit[] {
		const gl = this.#gl;
		if (!gl) return [];
		// Locals for one lookup; nothing reads them reactively.
		/* eslint-disable svelte/prefer-svelte-reactivity */
		const byLayer = new Map<string, Registration>();
		for (const registration of this.#registrations) {
			for (const id of registration.layerIds) {
				// MapLibre errors on querying a missing layer (e.g. mid basemap change).
				if (!byLayer.has(id) && gl.getLayer(id)) byLayer.set(id, registration);
			}
		}
		if (byLayer.size === 0) return [];
		const hits: FeatureHit[] = [];
		const seen = new Set<string>();
		/* eslint-enable svelte/prefer-svelte-reactivity */
		for (const feature of gl.queryRenderedFeatures(point, { layers: [...byLayer.keys()] })) {
			const registration = byLayer.get(feature.layer.id);
			const hit = registration?.toHit(feature.properties ?? {});
			if (!registration || !hit || seen.has(hit.refKey)) continue;
			seen.add(hit.refKey);
			hits.push({ ...hit, pluginId: registration.pluginId });
		}
		return hits;
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

	#onClick = (e: PointerEventLike) => {
		const hits = this.hitsAt([e.point.x, e.point.y]);
		if (hits.length === 0) return;
		const o = e.originalEvent;
		const event: ClickEvent = {
			hits,
			additive: Boolean(o?.shiftKey || o?.metaKey || o?.ctrlKey || o?.pointerType === "touch"),
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
		const hit = this.hitsAt([e.point.x, e.point.y])[0];
		this.#hovered = hit ? { hit, lngLat: [e.lngLat.lng, e.lngLat.lat] } : null;
	};

	#onOut = () => {
		this.#hovered = null;
	};
}
