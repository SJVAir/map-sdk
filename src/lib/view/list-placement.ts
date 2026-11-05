/** A corner of the map. */
export type ListPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** `MapView`'s `featureList` options. */
export interface FeatureListOptions {
	/** The corner the List button sits in; its panel opens from there. Default `"top-left"`. */
	position?: ListPosition;
	/**
	 * `"always"` (default) shows the button. `"focus"` shows it only while it, or its open panel,
	 * has keyboard focus, and the whole time the panel is open; otherwise it's visually hidden but
	 * stays in the Tab order and the accessibility tree, like a skip link.
	 */
	reveal?: "always" | "focus";
}

/** The `featureList` prop with its defaults filled in, or `null` when the list is off. */
export function resolveFeatureList(
	value: boolean | FeatureListOptions | undefined
): Required<FeatureListOptions> | null {
	if (value === false) return null;
	const options = value === true || value === undefined ? {} : value;
	return { position: options.position ?? "top-left", reveal: options.reveal ?? "always" };
}

/** A corner's edges, and the other corner on the same side (where the panel must stop). */
export function cornerSides(position: ListPosition): {
	vertical: "top" | "bottom";
	horizontal: "left" | "right";
	far: ListPosition;
} {
	const [vertical, horizontal] = position.split("-") as ["top" | "bottom", "left" | "right"];
	const far = `${vertical === "top" ? "bottom" : "top"}-${horizontal}` as ListPosition;
	return { vertical, horizontal, far };
}
