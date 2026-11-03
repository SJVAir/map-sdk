import type { FeatureHit } from "./plugin.js";

interface Registration {
	pluginId: string;
	layerIds: string[];
	toHit: (props: Record<string, unknown>) => FeatureHit | null;
}

/** Routes click, hover, and tooltip events on plugin layers to feature hits. One per map. */
export class InteractionRouter {
	#registrations = new Set<Registration>();

	/** Records the layers whose features `toHit` turns into hits. Returns an unregister function. */
	register(
		pluginId: string,
		layerIds: string[],
		toHit: (props: Record<string, unknown>) => FeatureHit | null
	): () => void {
		const registration: Registration = { pluginId, layerIds: [...layerIds], toHit };
		this.#registrations.add(registration);
		return () => {
			this.#registrations.delete(registration);
		};
	}
}
