import type { FeatureRef } from "./types.js";

/** A place as `@sjvair/sdk` and the dashboard name it: a monitor, or a region by type and code. */
export type PlaceRef =
	{ kind: "monitor"; id: string } | { kind: "region"; type: string; code: string };

export function encodeRef(ref: FeatureRef): string {
	switch (ref.kind) {
		case "monitor":
			return `monitor:${ref.id}`;
		case "region":
			return `region:${ref.type}:${ref.code}`;
		case "feature":
			return `feature:${ref.id}`;
	}
}

export function decodeRef(key: string): FeatureRef | null {
	const first = key.indexOf(":");
	if (first < 0) return null;
	const kind = key.slice(0, first);
	const rest = key.slice(first + 1);
	if (kind === "monitor" || kind === "feature") {
		return rest ? { kind, id: rest } : null;
	}
	if (kind === "region") {
		const second = rest.indexOf(":");
		if (second <= 0) return null;
		const code = rest.slice(second + 1);
		return code ? { kind, type: rest.slice(0, second), code } : null;
	}
	return null;
}

export function selectionId(ref: FeatureRef): string | null {
	switch (ref.kind) {
		case "monitor":
			return ref.id;
		case "region":
			return `${ref.type}:${ref.code}`;
		case "feature":
			return null;
	}
}

export function toPlaceRef(ref: FeatureRef): PlaceRef | null {
	switch (ref.kind) {
		case "monitor":
			return { kind: "monitor", id: ref.id };
		case "region":
			return { kind: "region", type: ref.type, code: ref.code };
		case "feature":
			return null;
	}
}

export function fromPlaceRef(place: { kind: string; [k: string]: unknown }): FeatureRef | null {
	if (place.kind === "monitor" && typeof place.id === "string" && place.id) {
		return { kind: "monitor", id: place.id };
	}
	if (
		place.kind === "region" &&
		typeof place.type === "string" &&
		typeof place.code === "string" &&
		place.type &&
		place.code
	) {
		return { kind: "region", type: place.type, code: place.code };
	}
	return null;
}
