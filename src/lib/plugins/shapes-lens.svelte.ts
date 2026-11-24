import type { Snippet } from "svelte";
import { untrack } from "svelte";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { FeatureListItem, LegendData, MapPlugin, PluginContext } from "../core/plugin.js";
import { containsPoint, geometryBbox } from "../core/shape-view.js";
import type { DataSource, MapFeatureProperties } from "../data/types.js";
import { lensParentOf } from "./lens-hooks.js";
import { createLensState } from "./lens-state.svelte.js";
import { shapesPlugin, type ShapesTooltipEnv } from "./shapes.svelte.js";
import { themeColors } from "./style.js";
import { tileBounds } from "./tile-bounds.js";

export interface ShapesLensOptions<C extends MapFeatureProperties> {
	id: string;
	/** The parents' plugin: a choropleth `shapesPlugin`. Add the lens right after it. */
	parents: MapPlugin;
	/** The children. The host fills it for `center`, typically on a short debounce. */
	source: DataSource<C>;
	/** The parents whose children the lens shows when centred on `refKey`, itself included. */
	block(refKey: string): string[];
	/** A child's parent refKey (for recentring and for which parents to hide). */
	parentOf(props: C): string | null;
	/**
	 * Whether the source holds every child of this parent. A parent hides under its children only
	 * once it says so, so one with just a few children loaded (a host's cached edge sections) never
	 * shows clear around them. Read reactively. Default: always.
	 */
	childrenLoaded?(parentKey: string): boolean;
	/** Already-translated name of the children, for the list, summary and legend. */
	layerLabel: string;
	/** Fill opacity where a level sets none. Default 0.6. */
	fillOpacity?: number;
	outline?: "theme" | "level" | "none";
	noFigure?: "neutral" | "outline";
	/** As on `shapesPlugin`: the children's text in place of "No data" (outline only). */
	noFigureLabel?: string;
	/** As on `shapesPlugin`: a child's reason for having no figure, or its text for no level. */
	detail?(props: C): string | undefined;
	tooltip?(item: FeatureListItem, props: C, env: ShapesTooltipEnv): Snippet | undefined;
	tooltipShowsName?: boolean;
	legendUnits?: string;
	legendNote?: Snippet;
	/** As on `shapesPlugin`: a gradient (default) or labeled blocks. */
	legendDisplay?: "gradient" | "blocks";
}

export interface ShapesLens extends MapPlugin {
	/** Reactive: the parent the lens is centred on, or null. */
	readonly center: string | null;
	/** Reactive: pinned by `pin`. */
	readonly pinned: boolean;
	/** Centres the lens on `refKey` and pins it ("Show square miles"). */
	pin(refKey: string): void;
	/** Unpins and drops the lens. */
	release(): void;
}

const CENTER_WIDTH = 2;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * A lens over a choropleth `shapesPlugin`: the parent under the pointer (a township) opens into
 * child shapes (its 3×3 block's sections), drawn over the parents, which hide where their
 * children are drawn. Hover raises and moves it; `pin` holds it (the keyboard and touch path).
 * A plugin of its own, added right after its parents.
 */
export function shapesLens<C extends MapFeatureProperties>(
	options: ShapesLensOptions<C>
): ShapesLens {
	const found = lensParentOf(options.parents);
	if (!found || !found.choropleth) {
		throw new Error("map-sdk: shapesLens needs a choropleth shapesPlugin as parents");
	}
	const { id, source, parentOf } = options;
	const hooks = found;

	let ctxRef: PluginContext | null = $state.raw(null);

	const childParents = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole, never mutated
		const out = new Map<string, string>();
		for (const f of filtered?.features ?? []) {
			const parent = f.properties ? parentOf(f.properties) : null;
			if (parent) out.set(f.properties.refKey, parent);
		}
		return out;
	});

	const state = createLensState({
		parentsId: options.parents.id,
		lensId: id,
		parent: () => ctxRef?.hoverOf(options.parents.id) ?? null,
		child: () => ctxRef?.hoverOf(id) ?? null,
		childParent: (refKey) => childParents.get(refKey) ?? null,
		inBlock: (lngLat) => {
			const center = state.center;
			if (!center) return false;
			return options.block(center).some((key) => {
				const geometry = hooks.geometryOf(key);
				return geometry !== null && containsPoint(geometry, lngLat);
			});
		},
		blockHas: (refKey) => blockKeys.has(refKey),
		pinnedCard: () => ctxRef?.pinned ?? null,
		focusedKey: () => ctxRef?.focusedKey ?? null,
		pointerInCard: () => ctxRef?.pointerInCard ?? false,
		inRange: () => hooks.shown && hooks.live,
		parentKeys: () => hooks.keys
	});

	const showing = $derived(state.center !== null);
	/** The children's scale has resolved, so their layers are built. */
	const innerReady = (): boolean => {
		const data = inner.legend?.();
		return !!data && "scale" in data;
	};

	const blockKeys = $derived.by(() => {
		const center = state.center;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole, never mutated
		return new Set(center ? options.block(center) : []);
	});

	// Only the block's children: a host may keep neighbouring blocks (its cache) in the source.
	const filtered = $derived.by((): FeatureCollection<Geometry, C> | null => {
		const all = source.features;
		if (!all || blockKeys.size === 0) return null;
		const features = all.features.filter((f) => {
			const parent = f.properties ? parentOf(f.properties) : null;
			return parent !== null && blockKeys.has(parent);
		});
		return features.length ? { type: "FeatureCollection", features } : null;
	});

	const blockSource: DataSource<C> = {
		get status() {
			return source.status;
		},
		get scale() {
			return source.scale;
		},
		get features() {
			return filtered;
		}
	};

	const inner = shapesPlugin<C>({
		id,
		source: blockSource,
		layerLabel: options.layerLabel,
		mode: "choropleth",
		fillOpacity: options.fillOpacity,
		outline: options.outline,
		noFigure: options.noFigure,
		noFigureLabel: options.noFigureLabel,
		detail: options.detail,
		tooltip: options.tooltip,
		tooltipShowsName: options.tooltipShowsName,
		legendUnits: options.legendUnits,
		legendNote: options.legendNote,
		legendDisplay: options.legendDisplay
	});

	function setup(ctx: PluginContext): () => void {
		ctxRef = ctx;
		const teardownInner = inner.setup(ctx);
		const stopState = state.start();
		const container = ctx.gl.getCanvas().closest?.("[data-mapsdk-map]") ?? null;
		const theme = themeColors(container);

		const centerSource = ctx.addSource("center", { type: "geojson", data: EMPTY });
		/** Adds the outline layer last, so it draws over the children's layers built before it. */
		const raiseOutline = () => {
			const layerId = ctx.id("center-outline");
			if (ctx.gl.getLayer(layerId)) ctx.gl.removeLayer(layerId);
			ctx.addLayer("center-outline", {
				type: "line",
				source: centerSource,
				paint: { "line-color": theme.foreground, "line-width": CENTER_WIDTH }
			});
		};

		// The parents beneath hide only where a child is drawn (and the children's scale has
		// resolved, so their layers exist), so the block never shows empty. The set applies whole
		// once the children's source has loaded its latest data: hidden before their tiles come,
		// a parent would show clear for a frame, and shown before, under the old children.
		const childSource = ctx.id("shapes");
		let pending: ReadonlySet<string> | null = null;
		/** What the parents were last given. */
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never mutated
		let applied: ReadonlySet<string> = new Set();
		const setHidden = (keys: ReadonlySet<string>) => {
			applied = keys;
			hooks.setHidden(keys);
		};
		const apply = () => {
			if (!pending || !ctxRef) return;
			setHidden(pending);
			pending = null;
		};
		/** Applies now unless the children's source is loading (a `setData` this flush made). */
		const applyIfLoaded = () => {
			if (!ctxRef || (ctx.gl.getSource(childSource) && !ctx.gl.isSourceLoaded(childSource))) return;
			apply();
		};
		// A parent leaving the set shows on the frame its children go: the first reloaded tile that
		// overlaps it, not the whole load, which can come frames later (MapLibre swaps a source's
		// tiles one at a time). One across two tiles may tint for a frame in the slower one.
		const showUnder = (tile: unknown) => {
			const bounds = tileBounds(tile);
			if (!pending || !bounds) return;
			const [west, south, east, north] = bounds;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole, never mutated
			const kept = new Set<string>();
			for (const key of applied) {
				const geometry = pending.has(key) ? null : hooks.geometryOf(key);
				const box = geometry ? geometryBbox(geometry) : null;
				const under = !!box && box[0] < east && box[2] > west && box[1] < north && box[3] > south;
				if (!under) kept.add(key);
			}
			if (kept.size < applied.size) setHidden(kept);
		};
		// Only a loaded tile (or the source's first `idle`) applies the set: `metadata` comes before
		// the tiles reload, and either can say loaded while the children have no layers, and so no
		// tiles. Hiding waits for the whole load, so no arriving parent shows clear.
		const onData = (e: {
			sourceId?: string;
			isSourceLoaded?: boolean;
			tile?: unknown;
			sourceDataType?: string;
		}) => {
			if (e.sourceId !== childSource) return;
			if (e.tile) showUnder(e.tile);
			if (e.isSourceLoaded && (e.tile || e.sourceDataType === "idle")) apply();
		};
		// A failed load mustn't leave the parents as they were: apply as if it had drawn. (A failed
		// tile applies the set while others may still reload, a frame early there at worst.)
		const onError = (e: { sourceId?: string }) => {
			if (e.sourceId === childSource) apply();
		};
		ctx.gl.on("sourcedata", onData);
		ctx.gl.on("error", onError);
		// The backstop: at the map's idle every source has loaded and drawn, events or not (the
		// last reloading tile panned out of view, say).
		ctx.gl.on("idle", apply);
		ctx.effect(() => {
			const ready = innerReady();
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole, never mutated
			const parents = new Set(
				ready
					? [...childParents.values()].filter(
							(key) => hooks.keys.has(key) && (options.childrenLoaded?.(key) ?? true)
						)
					: []
			);
			pending = parents;
			// After the flush, so the children's `setData` in it counts whatever the effect order.
			// Without the children's layers nothing of theirs draws, so there's nothing to wait for.
			queueMicrotask(ready ? applyIfLoaded : apply);
		});

		// The centre parent's outline over the children, while any are drawn. It's re-added on top
		// when the centre changes or the children's layers come, not on every data change.
		let raisedFor: string | null = null;
		ctx.effect(() => {
			const center = state.center;
			const ready = innerReady();
			const geometry = center && filtered && ready ? hooks.geometryOf(center) : null;
			untrack(() => {
				const key = geometry ? center : null;
				if (key !== null && key !== raisedFor) raiseOutline();
				raisedFor = key;
				const data: FeatureCollection = geometry
					? {
							type: "FeatureCollection",
							features: [{ type: "Feature", geometry, properties: {} } as Feature]
						}
					: EMPTY;
				(
					ctx.gl.getSource(centerSource) as { setData(d: FeatureCollection): void } | undefined
				)?.setData($state.snapshot(data) as FeatureCollection);
			});
		});

		// Esc dismisses the lens (WCAG 1.4.13) while one shows: from this map, or with focus on
		// nothing, never an Esc something else took (the list's, a host dialog's) or another map's.
		ctx.effect(() => {
			if (!showing || typeof document === "undefined") return;
			const onKey = (e: KeyboardEvent) => {
				if (e.key !== "Escape" || e.defaultPrevented) return;
				const active = document.activeElement;
				const inMap = !!container && !!active && container.contains(active);
				const onBody = !active || active === document.body;
				if (!inMap && !onBody) return;
				// A card pinned over a hover lens takes Esc first; the hold ends when it closes.
				if (!state.pinned && untrack(() => ctx.pinned) !== null) return;
				// A pinned lens lets go only for an Esc from its own map.
				if (state.pinned && !inMap) return;
				state.escape();
			};
			document.addEventListener("keydown", onKey);
			return () => document.removeEventListener("keydown", onKey);
		});

		return () => {
			stopState();
			ctx.gl.off("sourcedata", onData);
			ctx.gl.off("error", onError);
			ctx.gl.off("idle", apply);
			pending = null;
			teardownInner();
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole, never mutated
			hooks.setHidden(new Set());
			ctxRef = null;
		};
	}

	const legend = (): LegendData | null => (filtered ? (inner.legend?.() ?? null) : null);
	const features = (): FeatureListItem[] => (state.pinned ? (inner.features?.() ?? []) : []);
	/** A drawn child's item, pinned or not: a hover lens's section card shows its content. */
	const itemFor = (refKey: string): FeatureListItem | undefined =>
		filtered ? inner.features?.().find((f) => f.refKey === refKey) : undefined;

	const plugin: ShapesLens = {
		id,
		label: options.layerLabel,
		get dataset() {
			return inner.dataset;
		},
		setup,
		legend,
		features,
		itemFor,
		selectable: false,
		summarizeEmpty: false,
		get center() {
			return state.center;
		},
		get pinned() {
			return state.pinned;
		},
		pin: (refKey) => state.pin(refKey),
		release: () => state.release()
	};
	if (inner.tooltip) plugin.tooltip = inner.tooltip;
	if (inner.tooltipShowsName) plugin.tooltipShowsName = true;
	return plugin;
}
