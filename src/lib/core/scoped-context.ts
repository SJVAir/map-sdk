import type { PluginContext } from "./plugin.js";

/**
 * A view of `ctx` whose local ids all start with `prefix`, so several plugins can be set up
 * inside one (one id, one teardown) without their sources, layers, and images colliding.
 * Everything else is the parent's, read live (`selectedKeys` stays reactive).
 */
export function scopedContext(ctx: PluginContext, prefix: string): PluginContext {
	const local = (name: string) => `${prefix}${name}`;
	return {
		get gl() {
			return ctx.gl;
		},
		get metadata() {
			return ctx.metadata;
		},
		get messages() {
			return ctx.messages;
		},
		get format() {
			return ctx.format;
		},
		get selectedKeys() {
			return ctx.selectedKeys;
		},
		id: (name) => ctx.id(local(name)),
		addSource: (name, spec) => ctx.addSource(local(name), spec),
		addLayer: (name, spec) => ctx.addLayer(local(name), spec),
		addCustomLayer: (name, create) => ctx.addCustomLayer(local(name), create),
		addImage: (name, image) => ctx.addImage(local(name), image),
		interactive: (layerIds, toHit) => ctx.interactive(layerIds, toHit),
		blocking: (layerIds, toHover, onClick) => ctx.blocking(layerIds, toHover, onClick),
		on: (type, layerId, listener) => ctx.on(type, layerId, listener),
		effect: (fn) => ctx.effect(fn)
	};
}
