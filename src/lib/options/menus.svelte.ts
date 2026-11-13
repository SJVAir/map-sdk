import { SvelteSet } from "svelte/reactivity";

/**
 * One toolbar's open menus: those opened by a click (at most one on the wide toolbar, any number
 * of sections in the narrow panel) and the one a mouse is over (wide only).
 */
export class OptionsMenus {
	#clicked = new SvelteSet<string>();
	#hovered = $state<string | null>(null);

	/** The menu a mouse is showing, if any. */
	get hovered(): string | null {
		return this.#hovered;
	}

	/** Forgets menus whose groups are gone or disabled, so they don't reopen by themselves. */
	keepOnly(ids: ReadonlySet<string>): void {
		for (const id of [...this.#clicked]) if (!ids.has(id)) this.#clicked.delete(id);
		if (this.#hovered !== null && !ids.has(this.#hovered)) this.#hovered = null;
	}

	/** Whether any menu is open. */
	get anyOpen(): boolean {
		return this.#clicked.size > 0 || this.#hovered !== null;
	}

	isOpen(id: string): boolean {
		return this.#clicked.has(id) || this.#hovered === id;
	}

	/** `single`: opening one closes the rest (the wide toolbar). */
	toggle(id: string, single: boolean): void {
		// A click on a dropdown a mouse is showing keeps it open after the mouse leaves.
		if (this.#clicked.has(id)) {
			this.close(id);
			return;
		}
		if (single) this.closeAll();
		this.#clicked.add(id);
	}

	/** A mouse over a trigger: shows it, and closes a dropdown left open by a click elsewhere. */
	hover(id: string): void {
		for (const other of [...this.#clicked]) if (other !== id) this.#clicked.delete(other);
		this.#hovered = id;
	}

	unhover(id: string): void {
		if (this.#hovered === id) this.#hovered = null;
	}

	close(id: string): void {
		this.#clicked.delete(id);
		if (this.#hovered === id) this.#hovered = null;
	}

	closeAll(): void {
		this.#clicked.clear();
		this.#hovered = null;
	}
}
