import type { LayerSpecification, SourceSpecification } from "@maptiler/sdk";
import type { Geometry } from "geojson";

/**
 * The subset of MapLibre's `Map` the core and plugins use. Types only, so nothing in core/
 * pulls the map engine at runtime, and tests can pass an in-memory fake.
 */
export interface GlMapLike {
	addSource(id: string, source: SourceSpecification): void;
	removeSource(id: string): void;
	getSource(id: string): unknown;
	addLayer(layer: LayerSpecification, beforeId?: string): void;
	removeLayer(id: string): void;
	getLayer(id: string): unknown;
	addImage(
		id: string,
		image: HTMLImageElement | ImageData,
		options?: { pixelRatio?: number }
	): void;
	hasImage(id: string): boolean;
	removeImage(id: string): void;
	setFeatureState(
		target: { source: string; id: string | number },
		state: Record<string, unknown>
	): void;
	removeFeatureState(target: { source: string; id?: string | number }, key?: string): void;
	queryRenderedFeatures(
		point: [number, number] | [[number, number], [number, number]],
		options?: { layers?: string[] }
	): Array<{
		layer: { id: string };
		source: string;
		id?: string | number;
		properties: Record<string, unknown>;
		geometry: Geometry;
	}>;
	isStyleLoaded(): boolean | void;
	setStyle(style: unknown): void;
	/* eslint-disable @typescript-eslint/no-explicit-any -- MapLibre's event payloads vary by type */
	on(type: string, listener: (e: any) => void): void;
	on(type: string, layerId: string, listener: (e: any) => void): void;
	off(type: string, listener: (e: any) => void): void;
	off(type: string, layerId: string, listener: (e: any) => void): void;
	/* eslint-enable @typescript-eslint/no-explicit-any */
	getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
	getCenter(): { lng: number; lat: number };
	getZoom(): number;
	getBearing(): number;
	getPitch(): number;
	easeTo(options: { center?: [number, number]; zoom?: number; duration?: number }): void;
	jumpTo(options: {
		center?: [number, number];
		zoom?: number;
		bearing?: number;
		pitch?: number;
	}): void;
	/** Canvas pixel for a position. */
	project(lngLat: [number, number]): { x: number; y: number };
	getCanvas(): HTMLCanvasElement;
	remove(): void;
}
