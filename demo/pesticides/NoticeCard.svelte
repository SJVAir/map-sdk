<script lang="ts">
	import type { NoticeProps } from "../pesticide-data.js";

	let { props }: { props: NoticeProps } = $props();
</script>

<div class="notice-card text-sm">
	<p><strong>{props.count}</strong> {props.count === 1 ? "notice" : "notices"} of intent</p>
	<p>{props.start} to {props.end}</p>
	{#if props.products.length}
		<p>{props.products.join(", ")}</p>
	{/if}
	<a href="#notice-{props.refKey}">Notice details</a>
</div>

<style>
	.notice-card {
		display: grid;
		gap: 0.25rem;
	}
	p {
		margin: 0;
	}
	a {
		color: var(--primary);
		text-decoration: underline;
	}
</style>
