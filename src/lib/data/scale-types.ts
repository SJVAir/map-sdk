// Mirrors the server shape in sjvair.com docs/superpowers/specs/2026-11-03-metadata-scales-design.md.
// Types only; the scale helpers arrive in a later task.

export interface Level {
	key: string;
	label: string;
	color: string;
	opacity: number | null;
	tier: number | null;
	description: string;
	guidance: string;
	min?: number;
	max?: number | null;
	value?: string | number;
}

export interface Scale {
	id: string;
	label: string;
	units: string;
	kind: "range" | "category";
	levels: Level[];
	source?: { name: string; url: string };
}

export interface ScaleRef {
	dataset: string;
	entryType: string;
}
