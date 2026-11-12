<script lang="ts">
	import type { FormatProvider } from "../data/format.js";
	import type { MessageProvider } from "../data/messages.js";

	// A count bubble's content: how many of each type it gathers, one line per type present.

	interface Props {
		/** In order, only the types with a count above 0. */
		counts: Array<{ label: string; count: number }>;
		messages: MessageProvider;
		format: FormatProvider;
	}

	let { counts, messages, format }: Props = $props();
</script>

<div class="mapsdk-school-cluster text-sm">
	{#each counts as { label, count }, i (i)}
		<p class="mapsdk-school-line">
			{messages("mapsdk_schools_cluster_line", { count: format.number(count), type: label })}
		</p>
	{/each}
</div>

<style>
	.mapsdk-school-cluster {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.mapsdk-school-line {
		margin: 0;
	}
</style>
