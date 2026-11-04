import { darken, readableColor } from "color2k";

/** Colors for something filled with a level's color: the fill, a darker border, readable text. */
export interface LevelChipColors {
	background: string;
	border: string;
	text: string;
}

/**
 * The colors for a level color, or null when it is empty or unparseable (color2k throws there,
 * as monitor-map's `darken("")` did), so callers fall back to their neutral look.
 */
export function levelChip(color: string | null | undefined): LevelChipColors | null {
	if (!color) return null;
	try {
		return { background: color, border: darken(color, 0.1), text: readableColor(color) };
	} catch {
		return null;
	}
}
