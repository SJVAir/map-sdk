<script lang="ts">
	import Glyph from "./Glyph.svelte";
	import OptionIcon from "./OptionIcon.svelte";
	import OptionRows from "./OptionRows.svelte";
	import { getMapLayout } from "../view/map-layout.js";
	import { getToolbarContext } from "./toolbar-context.js";
	import type { OptionGroup } from "./types.js";

	let { group }: { group: OptionGroup } = $props();

	const ctx = getToolbarContext();
	const contentId = $derived(`${ctx.uid}-menu-${group.id}`);
	const open = $derived(ctx.menus.isOpen(group.id) && !group.disabled);
	// Icon-only on the wide toolbar, and only when there is an icon to show.
	const iconOnly = $derived(Boolean(group.iconOnly && group.icon && ctx.wide));

	let button: HTMLButtonElement;
	let body: HTMLDivElement;
	const layout = getMapLayout();

	/** Room inside the map, so a dropdown never spills past the tile (which clips it). */
	const EDGE = 8;
	let maxHeight = $state<number | null>(null);
	let flipped = $state(false);
	const align = $derived.by(() => {
		const side = group.align ?? "start";
		return flipped ? (side === "start" ? "end" : "start") : side;
	});

	// When it opens on the wide toolbar: cap its height by the room below the trigger, and align
	// it to whichever edge keeps it inside the map.
	$effect(() => {
		if (!open || !ctx.wide || !layout) {
			maxHeight = null;
			flipped = false;
			return;
		}
		const box = layout.box();
		if (!box) return;
		const trigger = button.getBoundingClientRect();
		maxHeight = Math.max(0, Math.floor(box.bottom - trigger.bottom - EDGE - 4));
		const width = body.getBoundingClientRect().width;
		const side = group.align ?? "start";
		flipped =
			side === "start"
				? trigger.left + width > box.right - EDGE && trigger.right - width >= box.left + EDGE
				: trigger.right - width < box.left + EDGE && trigger.left + width <= box.right - EDGE;
	});

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
		// decides), or the focused row being removed, which the effects below handle.
	}

	// New rows can remove the focused one. Chrome fires focusout as it goes and Firefox fires
	// nothing, so note before the update whether focus was in this dropdown, and after it hand
	// focus to the trigger if it fell to the page.
	// Values can remove it too: a select-all collapses when its last child is unchecked. Focus then
	// goes to that group's own checkbox, else the trigger.
	let focusWasInside = false;
	let focusGroup: string | undefined;
	$effect.pre(() => {
		void group.rows;
		void ctx.values;
		const active = document.activeElement;
		focusWasInside = !!body && body.contains(active);
		focusGroup = focusWasInside
			? active?.closest<HTMLElement>("[data-option-children]")?.dataset.optionChildren
			: undefined;
	});
	$effect(() => {
		void group.rows;
		void ctx.values;
		if (!focusWasInside) return;
		focusWasInside = false;
		const active = document.activeElement;
		if (!open || (active && active !== document.body)) return;
		const own = focusGroup
			? body.querySelector<HTMLElement>(`[data-option-group="${CSS.escape(focusGroup)}"]`)
			: null;
		(own ?? button)?.focus();
	});
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
		<span class={iconOnly ? "mapsdk-options-sr" : undefined}>{group.label}</span>
		{#if !iconOnly}
			<span class="mapsdk-options-chevron"><Glyph name="chevronDown" /></span>
		{/if}
	</button>
	<div id={contentId} class="mapsdk-options-dropdown" data-align={align} hidden={!open}>
		<div
			bind:this={body}
			class="mapsdk-options-dropdown-body"
			style:--mapsdk-options-max-height={maxHeight === null ? undefined : `${maxHeight}px`}
		>
			<OptionRows rows={group.rows} menuId={group.id} groupLabel={group.label} />
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
