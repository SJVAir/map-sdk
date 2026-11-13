<script lang="ts">
	import Glyph from "./Glyph.svelte";
	import OptionIcon from "./OptionIcon.svelte";
	import OptionRows from "./OptionRows.svelte";
	import { getToolbarContext } from "./toolbar-context.js";
	import type { OptionGroup } from "./types.js";

	let { group }: { group: OptionGroup } = $props();

	const ctx = getToolbarContext();
	const contentId = $derived(`${ctx.uid}-menu-${group.id}`);
	const open = $derived(ctx.menus.isOpen(group.id) && !group.disabled);

	let button: HTMLButtonElement;

	function onfocusout(e: FocusEvent) {
		if (!ctx.wide) return;
		const next = e.relatedTarget;
		const root = e.currentTarget as HTMLElement;
		if (next instanceof Node) {
			// Focus moving on past this dropdown (tabbing out of its last row) closes it.
			if (!root.contains(next)) ctx.menus.close(group.id);
			return;
		}
		// No destination: a click on something that takes no focus (the outside-click handler
		// decides), or the focused row being removed (new groups). Chrome fires this while the row
		// is still attached, so look a microtask later: a detached row hands focus to the trigger.
		const left = e.target as Node;
		queueMicrotask(() => {
			if (!left.isConnected && root.isConnected && ctx.menus.isOpen(group.id)) button?.focus();
		});
	}
</script>

<div
	class="mapsdk-options-menu"
	data-options-menu={group.id}
	role="presentation"
	onpointerenter={(e) => {
		if (ctx.wide && e.pointerType === "mouse" && !group.disabled) ctx.menus.hover(group.id);
	}}
	onpointerleave={(e) => {
		if (e.pointerType === "mouse") ctx.menus.unhover(group.id);
	}}
	{onfocusout}
>
	<button
		bind:this={button}
		type="button"
		class="mapsdk-options-trigger mapsdk-focus mapsdk-motion text-sm"
		disabled={group.disabled}
		aria-expanded={open}
		aria-controls={contentId}
		onclick={() => ctx.menus.toggle(group.id, ctx.wide)}
	>
		{#if group.icon}<OptionIcon icon={group.icon} />{/if}
		<span class={group.iconOnly && ctx.wide ? "mapsdk-options-sr" : undefined}>{group.label}</span>
		{#if !(group.iconOnly && ctx.wide)}
			<span class="mapsdk-options-chevron"><Glyph name="chevronDown" /></span>
		{/if}
	</button>
	<div
		id={contentId}
		class="mapsdk-options-dropdown"
		data-align={group.align ?? "start"}
		hidden={!open}
	>
		<div class="mapsdk-options-dropdown-body">
			<OptionRows rows={group.rows} menuId={group.id} />
		</div>
	</div>
</div>

<style>
	.mapsdk-options-menu {
		position: relative;
	}

	.mapsdk-options-trigger {
		display: flex;
		width: 100%;
		height: 2.5rem;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.75rem;
		border: 0;
		background: transparent;
		color: inherit;
		font-weight: 500;
		white-space: nowrap;
		user-select: none;
		cursor: pointer;
	}

	.mapsdk-options-trigger:hover:not(:disabled) {
		background: var(--accent, var(--muted));
	}

	.mapsdk-options-trigger:disabled {
		cursor: not-allowed;
	}

	.mapsdk-options-trigger:disabled > :global(*) {
		opacity: 0.5;
	}

	.mapsdk-options-chevron {
		display: inline-flex;
		margin-left: auto;
	}

	.mapsdk-options-sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.mapsdk-options-dropdown[hidden] {
		display: none;
	}

	/* Wide: a dropdown under its trigger. The narrow panel's sections override this (OptionsToolbar). */
	.mapsdk-options-dropdown {
		position: absolute;
		top: 100%;
		z-index: 1;
		min-width: 16rem;
		padding-top: 0.25rem;
	}

	.mapsdk-options-dropdown[data-align="start"] {
		left: 0;
	}

	.mapsdk-options-dropdown[data-align="end"] {
		right: 0;
	}

	.mapsdk-options-dropdown-body {
		max-height: var(--mapsdk-options-max-height, 69vh);
		overflow-y: auto;
		padding: 0.25rem 0;
		border: 1px solid var(--card-border, var(--border));
		border-radius: var(--radius-control, var(--radius));
		background: var(--background);
		color: var(--foreground);
		box-shadow: var(--shadow-lifted, var(--shadow-card, none));
	}
</style>
