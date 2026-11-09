import type { CustomLayerInterface, LayerSpecification, SourceSpecification } from "@maptiler/sdk";
import type { Geometry } from "geojson";
import type { Snippet } from "svelte";
import type { FormatProvider } from "../data/format.js";
import type { MessageProvider } from "../data/messages.js";
import type { MetadataProvider } from "../data/metadata.js";
import type { NO_LEVEL } from "../data/scale.js";
import type { Level, Scale } from "../data/scale-types.js";
import type { DataStatus, FeatureRef } from "../data/types.js";
import type { GlMapLike } from "./gl.js";

export type Providers = {
	metadata: MetadataProvider;
	messages: MessageProvider;
	format: FormatProvider;
};

/**
 * A layer spec without its id (the host assigns it). Distributive: `Omit` over the
 * `LayerSpecification` union would keep only the keys every layer type shares, losing `source`.
 */
export type LayerSpecWithoutId = LayerSpecification extends infer L
	? L extends unknown
		? Omit<L, "id">
		: never
	: never;

export interface FeatureHit {
	pluginId: string;
	ref: FeatureRef;
	refKey: string;
	name: string;
	/**
	 * The rendered feature's properties, for hover content of a hit no plugin lists (e.g. a
	 * cluster bubble's count and aggregates). Unset for ordinary hits.
	 */
	properties?: Readonly<Record<string, unknown>>;
}

/** The topmost feature of a blocking layer that was clicked. */
export interface BlockingClick {
	properties: Record<string, unknown>;
	geometry: Geometry;
}

export interface FeatureListItem {
	refKey: string;
	ref: FeatureRef;
	name: string;
	value: number | string | null;
	level: Level | typeof NO_LEVEL;
	units: string;
	/**
	 * Decimal places to show a numeric `value` with (the built-in plugins take it from the
	 * metadata's display hint). Without it the value is formatted as given.
	 */
	precision?: number;
	/**
	 * Cut a numeric `value` off at `precision` instead of rounding it, so the number never reads
	 * as the next level (e.g. fire power: 9.96 MW shows "9.9", not "10.0", beside "<10"). Default
	 * false.
	 */
	truncate?: boolean;
	lngLat: [number, number];
	/**
	 * The feature's shape. When given, the item is in view (the feature list, the view summary)
	 * when the shape overlaps the view, not only when `lngLat` is inside it, and focusing or
	 * hovering it while `lngLat` is off-screen pins its tooltip at a point of the shape in view
	 * (focus then leaves the camera where it is).
	 */
	geometry?: Geometry;
	/**
	 * `geometry`'s bounding box, `[west, south, east, north]` (`geometryBbox`). Optional; computed
	 * from `geometry` when missing. A plugin listing many shapes should measure it once per data
	 * load, since the list and summary test every item on every move.
	 */
	bbox?: [number, number, number, number];
	selectable: boolean;
	/**
	 * A short text about a feature with no level (e.g. "Level 2 charger"), shown where its level
	 * would be: in the feature list, its row's accessible name, and the generic tooltip. Ignored
	 * when the item has a level.
	 */
	detail?: string;
}

export type LegendData =
	| {
			pluginId: string;
			title: string;
			units: string;
			scale: Scale;
			/**
			 * `"gradient"` or `"blocks"` (labeled swatches with the levels' own labels). Absent: a
			 * gradient for range scales and blocks for category scales.
			 */
			display?: "gradient" | "blocks";
	  }
	| { pluginId: string; status: DataStatus };

export interface ClickEvent {
	hits: FeatureHit[];
	additive: boolean;
	lngLat: [number, number];
}

/**
 * What a plugin's `setup` gets. Everything added through it is removed automatically when the
 * plugin is torn down, whether or not the plugin's own teardown cleans up.
 */
export interface PluginContext {
	/**
	 * The GL map. Don't use it after teardown: do late async work (an image that finishes
	 * loading, a fetch) through the context's methods, which do nothing once torn down.
	 */
	readonly gl: GlMapLike;
	/** `${mapUid}:${pluginId}:${local}` */
	id(local: string): string;
	readonly metadata: MetadataProvider;
	readonly messages: MessageProvider;
	readonly format: FormatProvider;
	/** Returns the namespaced id; removed on teardown. */
	addSource(local: string, spec: SourceSpecification): string;
	/** Returns the namespaced id; removed on teardown, before sources. */
	addLayer(local: string, spec: LayerSpecWithoutId): string;
	/**
	 * Adds a MapLibre custom layer (e.g. a wind layer from a library the host adds) in the
	 * plugin's draw-order slot, with the same lifecycle as `addLayer`. `create` gets the
	 * namespaced id, which the layer must use; the object it returns is added as is, never copied,
	 * and `create` runs again on each restyle, so build a fresh layer every time. Returns the id.
	 */
	addCustomLayer(local: string, create: (id: string) => CustomLayerInterface): string;
	/** Adds the image as `id(local)`; removed on teardown. */
	addImage(local: string, image: HTMLImageElement | ImageData): void;
	/** Registers layers for click, hover, tooltip, and `featuresAt`. */
	interactive(
		layerIds: string[],
		toHit: (props: Record<string, unknown>) => FeatureHit | null
	): void;
	/**
	 * Layers that hide what is beneath them (e.g. cluster bubbles): where one is topmost, a click
	 * picks nothing and calls `onClick` with that feature, and the hover is `toHover`'s hit for it
	 * (for its tooltip), or nothing. `toHover` must have no side effects (lookups call it too).
	 */
	blocking(
		layerIds: string[],
		toHover?: (props: Record<string, unknown>) => FeatureHit | null,
		onClick?: (feature: BlockingClick) => void
	): void;
	/** A layer event listener (e.g. a cluster click), removed on teardown. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MapLibre's event payloads vary
	on(type: string, layerId: string, listener: (e: any) => void): void;
	/** Reactive. */
	readonly selectedKeys: ReadonlySet<string>;
	/** An `$effect.root` torn down with the plugin. */
	effect(fn: () => void | (() => void)): void;
}

/**
 * A layer of data on a map. A plugin object keeps per-map state, so it belongs to one map: create
 * one plugin per map (adding an object that is set up on another map throws).
 */
export interface MapPlugin {
	id: string;
	/** Already-translated layer name, for the selection bar and view summary. */
	label?: string;
	/** The metadata dataset the plugin's data comes from (for attribution); may change with its source. */
	readonly dataset?: string;
	/** Adds sources, layers, and icons; returns its teardown. Runs only once a style is loaded. */
	setup(ctx: PluginContext): () => void;
	legend?(): LegendData | null;
	features?(): FeatureListItem[];
	selectable?: boolean;
	/**
	 * Which plugin's feature the hover tooltip shows where several are under the pointer: the
	 * highest wins, the topmost on a tie. Default 0. Over a blocking layer (a cluster bubble), a
	 * feature beneath shows only if its plugin's priority is higher than the blocking plugin's.
	 * Clicks ignore this (topmost first), and a blocking layer on top still blocks them.
	 */
	hoverPriority?: number;
	/**
	 * False: the plugin's features never take the hover (so no hover tooltip and no pointer
	 * cursor) and never hide a feature beneath from it, as if they weren't rendered. Clicks,
	 * `featuresAt`, and keyboard focus from the list are unchanged. Default true.
	 */
	hoverable?: boolean;
	displayOptions?: Snippet;
	/** Richer tooltip content for one of this plugin's features, below its name. */
	tooltip?(item: FeatureListItem): Snippet | undefined;
	/**
	 * Set when this plugin's `tooltip` content shows the feature's name itself, so the generic
	 * tooltip leaves its name header out. Default false.
	 */
	tooltipShowsName?: boolean;
	/**
	 * Tooltip content for a hovered hit that isn't a listed feature (e.g. a cluster bubble's hover
	 * hit from `PluginContext.blocking`).
	 */
	hoverTooltip?(hit: FeatureHit): Snippet | undefined;
}
