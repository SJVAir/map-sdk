/**
 * Props for a component mounted outside the map's tree that can be updated by assigning to them.
 */
export function reactiveProps<T extends object>(initial: T): T {
	const props = $state(initial);
	return props;
}
