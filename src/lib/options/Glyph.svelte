<script lang="ts">
	import { GLYPHS, type GlyphName } from "./glyphs.js";

	let { name, size = 16 }: { name: GlyphName; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each GLYPHS[name] as d, i (i)}
		<path {d} />
	{/each}
</svg>
