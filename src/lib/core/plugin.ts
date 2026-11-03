import type { LayerSpecification, SourceSpecification } from "@maptiler/sdk";
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
}

export interface FeatureListItem {
	refKey: string;
	ref: FeatureRef;
	name: string;
	value: number | string | null;
	level: Level | typeof NO_LEVEL;
	units: string;
	lngLat: [number, number];
	selectable: boolean;
}

export type LegendData =
	| { pluginId: string; title: string; units: string; scale: Scale }
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
	/** Adds the image as `id(local)`; removed on teardown. */
	addImage(local: string, image: HTMLImageElement | ImageData): void;
	/** Registers layers for click, hover, tooltip, and `featuresAt`. */
	interactive(
		layerIds: string[],
		toHit: (props: Record<string, unknown>) => FeatureHit | null
	): void;
	/** A layer event listener (e.g. a cluster click), removed on teardown. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MapLibre's event payloads vary
	on(type: string, layerId: string, listener: (e: any) => void): void;
	/** Reactive. */
	readonly selectedKeys: ReadonlySet<string>;
	/** An `$effect.root` torn down with the plugin. */
	effect(fn: () => void | (() => void)): void;
}

export interface MapPlugin {
	id: string;
	/** Adds sources, layers, and icons; returns its teardown. Runs only once a style is loaded. */
	setup(ctx: PluginContext): () => void;
	legend?(): LegendData | null;
	features?(): FeatureListItem[];
	selectable?: boolean;
	displayOptions?: Snippet;
}
