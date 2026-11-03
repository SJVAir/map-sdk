/** Runs `fn` in an `$effect` inside its own `$effect.root`, as a component would. Returns stop. */
export function rootEffect(fn: () => void): () => void {
	return $effect.root(() => {
		$effect(() => {
			fn();
		});
	});
}
