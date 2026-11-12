import { selectionId } from "./refs.js";
import type { FeatureRef, SelectionMode, SpatialSelection } from "./types.js";

export interface PickGesture {
	additive: boolean; // shift/Cmd/Ctrl, or touch in multiple mode (decided by MapView)
}

export function selectionKind(ref: FeatureRef): "monitors" | "regions" | null {
	switch (ref.kind) {
		case "monitor":
			return "monitors";
		case "region":
			return "regions";
		case "feature":
			return null;
	}
}

export function applyPick(
	current: SpatialSelection | null,
	ref: FeatureRef,
	mode: SelectionMode,
	gesture: PickGesture
): SpatialSelection | null {
	const kind = selectionKind(ref);
	const id = selectionId(ref);
	if (mode === "none" || kind === null || id === null) return current;

	if (mode === "single" || !gesture.additive || !current || current.kind !== kind) {
		return { kind, ids: [id] };
	}
	if (current.ids.includes(id)) {
		const ids = current.ids.filter((x) => x !== id);
		return ids.length ? { kind, ids } : null;
	}
	return { kind, ids: [...current.ids, id] };
}

/**
 * A modifier-click (or a card's Select/Remove): toggles `ref`. In `single` mode it is the
 * selection, or `null` when it already is; in `multiple` mode it is added or removed (another
 * kind starts a new selection, and removing the last id gives `null`).
 */
export function toggleInSelection(
	current: SpatialSelection | null,
	ref: FeatureRef,
	mode: SelectionMode
): SpatialSelection | null {
	const kind = selectionKind(ref);
	const id = selectionId(ref);
	if (mode === "none" || kind === null || id === null) return current;
	const has = current?.kind === kind && current.ids.includes(id);
	if (mode === "single") return has ? null : { kind, ids: [id] };
	if (!current || current.kind !== kind) return { kind, ids: [id] };
	if (has) {
		const ids = current.ids.filter((x) => x !== id);
		return ids.length ? { kind, ids } : null;
	}
	return { kind, ids: [...current.ids, id] };
}

export function selectionKeys(sel: SpatialSelection | null): Set<string> {
	if (!sel) return new Set();
	const prefix = sel.kind === "monitors" ? "monitor:" : "region:";
	return new Set(sel.ids.map((id) => prefix + id));
}
