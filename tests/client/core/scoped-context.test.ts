import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../../../src/lib/core/plugin.js";
import { scopedContext } from "../../../src/lib/core/scoped-context.js";

function parent() {
	let selected: ReadonlySet<string> = new Set();
	const ctx = {
		gl: {},
		metadata: {},
		messages: {},
		format: {},
		get selectedKeys() {
			return selected;
		},
		id: vi.fn((local: string) => `m:p:${local}`),
		addSource: vi.fn((local: string) => `m:p:${local}`),
		addLayer: vi.fn((local: string) => `m:p:${local}`),
		addCustomLayer: vi.fn((local: string) => `m:p:${local}`),
		addImage: vi.fn(),
		interactive: vi.fn(),
		blocking: vi.fn(),
		on: vi.fn(),
		effect: vi.fn()
	} as unknown as PluginContext;
	return { ctx, select: (keys: string[]) => (selected = new Set(keys)) };
}

describe("scopedContext", () => {
	it("prefixes every local id it hands the parent", () => {
		const { ctx } = parent();
		const scoped = scopedContext(ctx, "a:");
		expect(scoped.id("x")).toBe("m:p:a:x");
		expect(scoped.addSource("s", { type: "geojson", data: "" })).toBe("m:p:a:s");
		expect(scoped.addLayer("l", { type: "circle", source: "m:p:a:s" })).toBe("m:p:a:l");
		const create = vi.fn();
		expect(scoped.addCustomLayer("c", create)).toBe("m:p:a:c");
		expect(ctx.addCustomLayer).toHaveBeenCalledWith("a:c", create);
		const image = {} as ImageData;
		scoped.addImage("i", image);
		expect(ctx.addImage).toHaveBeenCalledWith("a:i", image);
	});

	it("passes the rest through and reads the parent live", () => {
		const { ctx, select } = parent();
		const scoped = scopedContext(ctx, "a:");
		expect(scoped.gl).toBe(ctx.gl);
		expect(scoped.metadata).toBe(ctx.metadata);
		expect(scoped.messages).toBe(ctx.messages);
		expect(scoped.format).toBe(ctx.format);
		select(["k"]);
		expect([...scoped.selectedKeys]).toEqual(["k"]);
		const toHit = () => null;
		scoped.interactive(["m:p:a:l"], toHit);
		expect(ctx.interactive).toHaveBeenCalledWith(["m:p:a:l"], toHit);
		scoped.blocking(["m:p:a:l"]);
		expect(ctx.blocking).toHaveBeenCalledWith(["m:p:a:l"], undefined, undefined);
		const listener = () => {};
		scoped.on("click", "m:p:a:l", listener);
		expect(ctx.on).toHaveBeenCalledWith("click", "m:p:a:l", listener);
		const fn = () => {};
		scoped.effect(fn);
		expect(ctx.effect).toHaveBeenCalledWith(fn);
	});
});
