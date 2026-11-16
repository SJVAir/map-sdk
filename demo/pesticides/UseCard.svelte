<script lang="ts">
	import type { UseProps } from "../pesticide-data.js";

	let { props, kind }: { props: UseProps; kind: "township" | "section" } = $props();
	const lbs = $derived(props.value === null ? null : Number(props.value));
	const peak = $derived(Math.max(1, ...props.monthly));
</script>

<div class="use-card text-sm">
	<p>
		{#if lbs === null}
			No reported use
		{:else}
			<strong>{lbs.toLocaleString()} lbs</strong> reported
		{/if}
		{#if kind === "township" && props.sections !== undefined}
			<span class="muted">· {props.sections} sections with use</span>
		{/if}
	</p>
	{#if props.topChemicals.length}
		<ul class="chemicals" aria-label="Top chemicals">
			{#each props.topChemicals as chemical (chemical)}
				<li class="badge text-xs">{chemical}</li>
			{/each}
		</ul>
	{/if}
	{#if kind === "section" && lbs !== null}
		<div class="bars" role="img" aria-label="Pounds by month, the last 12 months">
			{#each props.monthly as pounds, i (i)}
				<span style:height="{Math.round((pounds / peak) * 100)}%"></span>
			{/each}
		</div>
		<a href="#section-{props.mtrs}">Open the section</a>
	{/if}
</div>

<style>
	.use-card {
		display: grid;
		gap: 0.375rem;
	}
	p {
		margin: 0;
	}
	.muted {
		color: var(--muted-foreground);
	}
	.chemicals {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.badge {
		padding: 0 0.375rem;
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 2.5rem;
	}
	.bars span {
		flex: 1;
		min-height: 1px;
		background: var(--foreground);
	}
	a {
		color: var(--primary);
		text-decoration: underline;
	}
</style>
