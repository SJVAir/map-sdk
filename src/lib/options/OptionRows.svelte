<script lang="ts">
	import type { Attachment } from "svelte/attachments";
	import Glyph from "./Glyph.svelte";
	import OptionIcon from "./OptionIcon.svelte";
	import Self from "./OptionRows.svelte";
	import { getToolbarContext } from "./toolbar-context.js";
	import type { OptionRow } from "./types.js";
	import { applyGroup, applyReset, applyValue, choiceFor, groupStatus } from "./values.js";

	/** `menuId`: the group these rows are in, so a `closesMenu` radio can close it. */
	let { rows, menuId }: { rows: OptionRow[]; menuId: string } = $props();

	const ctx = getToolbarContext();
	const ro = $derived(ctx.readonly || undefined);

	/** `indeterminate` is a DOM property with no attribute; re-runs when it changes. */
	const partly =
		(on: boolean): Attachment<HTMLInputElement> =>
		(input) => {
			input.indeterminate = on;
		};

	/** Read-only: a click on a checkbox or radio does nothing (it stays focusable and readable). */
	function guard(e: MouseEvent) {
		if (ctx.readonly) e.preventDefault();
	}

	const name = (id: string) => `${ctx.uid}-${id}`;
</script>

{#each rows as row (`${row.kind}:${row.id}`)}
	{#if row.kind === "checkbox"}
		{@const on = ctx.valueOf(row.id) === true}
		<label class="mapsdk-option-row text-sm">
			<input
				type="checkbox"
				class="mapsdk-focus"
				checked={on}
				aria-disabled={ro}
				onclick={guard}
				onchange={(e) => ctx.emit(applyValue(row.id, e.currentTarget.checked, ctx.values))}
			/>
			{#if row.icon}<OptionIcon icon={row.icon} />{/if}
			<span class="mapsdk-option-label">{row.label}</span>
		</label>
		{#if row.children?.length && on}
			<div class="mapsdk-option-children"><Self rows={row.children} {menuId} /></div>
		{/if}
	{:else if row.kind === "group"}
		{@const status = groupStatus(row, ctx.values)}
		{#if status !== "empty"}
			{@const open = status !== "unchecked"}
			<label class="mapsdk-option-row text-sm">
				<input
					type="checkbox"
					class="mapsdk-focus"
					checked={status === "checked"}
					aria-disabled={ro}
					{@attach partly(status === "indeterminate")}
					onclick={guard}
					onchange={(e) => {
						ctx.emit(applyGroup(row, ctx.values, status !== "checked"));
						// The host's values decide what shows; until they arrive, show what they were.
						e.currentTarget.checked = status === "checked";
						e.currentTarget.indeterminate = status === "indeterminate";
					}}
				/>
				{#if row.icon}<OptionIcon icon={row.icon} />{/if}
				<span class="mapsdk-option-label">{row.label}</span>
				<span class="mapsdk-option-chevron" class:mapsdk-option-chevron-closed={!open}>
					<Glyph name="chevronDown" />
				</span>
			</label>
			{#if open}
				<div class="mapsdk-option-children"><Self rows={row.children} {menuId} /></div>
			{/if}
		{/if}
	{:else if row.kind === "radio"}
		{@const current = ctx.valueOf(row.id)}
		<div role="radiogroup" aria-label={row.label} class="mapsdk-option-radios">
			{#if row.label}
				<p class="mapsdk-option-heading text-sm" aria-hidden="true">
					{#if row.icon}<OptionIcon icon={row.icon} />{/if}
					{row.label}
				</p>
			{/if}
			{#each row.choices as choice (choice.value)}
				<label class="mapsdk-option-row mapsdk-option-row-tall text-sm">
					<span class="mapsdk-option-line">
						<input
							type="radio"
							class="mapsdk-focus"
							name={name(row.id)}
							value={choice.value}
							checked={choice.value === current}
							aria-disabled={ro}
							onclick={guard}
							onchange={() => {
								ctx.emit(applyValue(row.id, choice.value, ctx.values));
								if (row.closesMenu && ctx.wide) ctx.menus.close(menuId);
							}}
						/>
						{#if choice.icon}<OptionIcon icon={choice.icon} />{/if}
						<span>
							{choice.label}
							{#if choice.unit}<span class="mapsdk-option-muted text-xs">({choice.unit})</span>{/if}
						</span>
					</span>
					{#if choice.help}
						<span class="mapsdk-option-help mapsdk-option-muted text-xs">{choice.help}</span>
					{/if}
				</label>
			{/each}
		</div>
	{:else if row.kind === "select"}
		{@const chosen = choiceFor(row, ctx.valueOf(row.id))?.value ?? ""}
		<div class="mapsdk-option-select">
			<label for={name(row.id)} class="mapsdk-option-heading text-sm">
				{#if row.icon}<OptionIcon icon={row.icon} />{/if}
				{row.label}
			</label>
			<select
				id={name(row.id)}
				class="mapsdk-focus text-sm"
				value={chosen}
				aria-disabled={ro}
				onchange={(e) => {
					const picked = e.currentTarget.value;
					// Shows what the host has until the host's values say otherwise.
					e.currentTarget.value = chosen;
					ctx.emit(applyValue(row.id, picked, ctx.values));
				}}
			>
				{#each row.choices as choice (choice.value)}
					<option value={choice.value}>{choice.label}</option>
				{/each}
			</select>
		</div>
	{:else if row.kind === "action" || (row.kind === "reset" && ctx.defaults)}
		<div class="mapsdk-option-action">
			<button
				type="button"
				class="mapsdk-focus mapsdk-motion text-sm"
				aria-disabled={ro}
				onclick={() => {
					if (ctx.readonly) return;
					if (row.kind === "action") row.onclick();
					else if (ctx.defaults) ctx.emit(applyReset(ctx.defaults, ctx.values));
				}}
			>
				{#if row.icon}<OptionIcon icon={row.icon} />{/if}
				{row.label}
			</button>
		</div>
	{:else if row.kind === "separator"}
		<hr class="mapsdk-option-separator" />
	{/if}
{/each}

<style>
	.mapsdk-option-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
	}

	.mapsdk-option-row:hover {
		background: var(--accent, var(--muted));
	}

	.mapsdk-option-row-tall {
		flex-direction: column;
		align-items: stretch;
		gap: 0.125rem;
	}

	.mapsdk-option-line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.mapsdk-option-row input {
		width: 1rem;
		height: 1rem;
		flex-shrink: 0;
		margin: 0;
		accent-color: var(--primary);
	}

	.mapsdk-option-row input[aria-disabled="true"],
	.mapsdk-option-select select[aria-disabled="true"],
	.mapsdk-option-action button[aria-disabled="true"] {
		cursor: not-allowed;
	}

	.mapsdk-option-label {
		flex: 1;
	}

	.mapsdk-option-muted {
		color: var(--muted-foreground);
	}

	.mapsdk-option-help {
		padding-left: 1.5rem;
		white-space: normal;
	}

	.mapsdk-option-chevron {
		display: inline-flex;
		margin-left: 0.75rem;
		color: var(--muted-foreground);
	}

	.mapsdk-option-chevron-closed {
		transform: rotate(-90deg);
	}

	.mapsdk-option-children {
		margin-left: 1.25rem;
		border-left: 1px solid var(--border);
	}

	.mapsdk-option-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.375rem 0.75rem 0;
		font-weight: 600;
	}

	.mapsdk-option-select {
		padding-bottom: 0.375rem;
	}

	.mapsdk-option-select select {
		display: block;
		width: calc(100% - 1.5rem);
		margin: 0.25rem 0.75rem 0;
		padding: 0.375rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
	}

	.mapsdk-option-action {
		padding: 0.375rem 0.75rem;
	}

	.mapsdk-option-action button {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		cursor: pointer;
	}

	.mapsdk-option-action button:hover {
		background: var(--accent, var(--muted));
	}

	.mapsdk-option-separator {
		margin: 0.25rem 0;
		border: 0;
		border-top: 1px solid var(--border);
	}
</style>
