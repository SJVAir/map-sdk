import { untrack } from "svelte";
import type { MapPlugin } from "../../src/lib/core/plugin.js";

/**
 * A `$effect` in its own `$effect.root` that calls `fn` untracked, as a host component's effect
 * would. `rerun()` makes the effect run again.
 */
export function rerunnable(fn: () => void): { rerun(): void; stop(): void } {
	let count = $state(0);
	const stop = $effect.root(() => {
		$effect(() => {
			void count;
			untrack(fn);
		});
	});
	return {
		rerun() {
			count++;
		},
		stop
	};
}

/** A plugin whose setup creates two `ctx.effect`s, each reading its own state and counting runs. */
export function twoEffectPlugin(id: string): {
	plugin: MapPlugin;
	runs: { first: number; second: number };
	bump(which: "first" | "second"): void;
} {
	const values = $state({ first: 0, second: 0 });
	const runs = { first: 0, second: 0 };
	const plugin: MapPlugin = {
		id,
		setup(ctx) {
			ctx.effect(() => {
				void values.first;
				runs.first++;
			});
			ctx.effect(() => {
				void values.second;
				runs.second++;
			});
			return () => {};
		}
	};
	return {
		plugin,
		runs,
		bump(which) {
			values[which]++;
		}
	};
}
