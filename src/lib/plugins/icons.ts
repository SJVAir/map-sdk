import { darken } from "color2k";

// Marker shapes ported from monitor-map (src/lib/map/icons.ts). Shapes and sizes are
// presentation; every color comes in from a scale level or a theme token.

/**
 * A slightly darker stroke for a fill color. color2k throws on an empty or unparseable color
 * (monitor-map crashed on `darken("")`), so those keep the color itself.
 */
function strokeFor(color: string): string {
	try {
		return darken(color, 0.1);
	} catch {
		return color;
	}
}

export function square(color: string, borderWidth: number, borderColor?: string): string {
	return `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="${borderWidth / 2}" y="${borderWidth / 2}" width="${24 - borderWidth}" height="${24 - borderWidth}"
      fill="${color}" stroke="${strokeFor(borderColor ?? color)}" stroke-width="${borderWidth}"/>
  </svg>`;
}

export function circle(color: string, borderWidth: number, borderColor?: string): string {
	return `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="${12 - borderWidth}" fill="${color}" stroke="${strokeFor(borderColor ?? color)}" stroke-width="${borderWidth}"/>
  </svg>`;
}

export function triangle(color: string, borderWidth: number, borderColor?: string): string {
	const points = `${12},${borderWidth} ${24 - borderWidth},${24 - borderWidth} ${borderWidth},${24 - borderWidth}`;
	return `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${points}"
      fill="${color}" stroke="${strokeFor(borderColor ?? color)}" stroke-width="${borderWidth}"/>
  </svg>`;
}

// monitor-map's collocation crosshair (src/lib/map/icons.ts): a ring with ticks around a marker.
const CROSSHAIR_PATH =
	"M495.9 248H392c-4.4 0-8 3.6-8 8s3.6 8 8 8H495.9C491.7 390.2 390.2 491.7 264 495.9V392c0-4.4-3.6-8-8-8s-8 3.6-8 8V495.9C121.8 491.7 20.3 390.2 16.1 264H120c4.4 0 8-3.6 8-8s-3.6-8-8-8H16.1C20.3 121.8 121.8 20.3 248 16.1V120c0 4.4 3.6 8 8 8s8-3.6 8-8V16.1C390.2 20.3 491.7 121.8 495.9 248zM0 256a256 256 0 1 0 512 0A256 256 0 1 0 0 256z";
const CROSSHAIR_PADDING = 16;

/** The size of a `withCrosshair` image: a 24px marker plus the crosshair around it (56px). */
export const CROSSHAIR_ICON_SIZE = 24 + CROSSHAIR_PADDING * 2;

/**
 * A 24px marker SVG (`circle`, `square`, `triangle`) centered in a crosshair of `color`, as
 * monitor-map draws collocation sites. The result is `CROSSHAIR_ICON_SIZE` pixels square.
 */
export function withCrosshair(baseSvg: string, color: string): string {
	const size = CROSSHAIR_ICON_SIZE;
	const inner = baseSvg.replace("<svg ", `<svg x="${CROSSHAIR_PADDING}" y="${CROSSHAIR_PADDING}" `);
	return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${inner}<svg x="0" y="0" width="${size}" height="${size}" viewBox="-8 -8 528 528"><path d="${CROSSHAIR_PATH}" fill="${color}" stroke="${color}" stroke-width="5"/></svg></svg>`;
}

export function fireIcon(color: string, size: number): string {
	return `<svg width="${size}" height="${size}" viewBox="0 -960 960 960" xmlns="http://www.w3.org/2000/svg" fill="${color}"><path d="M200-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T608-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T361-690q-39 33-69 68.5t-50.5 72Q221-513 210.5-475T200-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T497-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T582-658l18-22q74 42 117 117t43 163q0 134-93 227T440-80q-134 0-227-93t-93-227q0-129 86.5-245T440-840Zm400 320q-17 0-28.5-11.5T800-560q0-17 11.5-28.5T840-600q17 0 28.5 11.5T880-560q0 17-11.5 28.5T840-520Zm-40-120v-200h80v200h-80Z"/></svg>`;
}

/** Room around the marker for the ring and the check badge. */
export const SELECTED_OVERLAY_PADDING = 6;

/**
 * The selection mark drawn over a selected marker `size` pixels across: a ring around it in
 * `highlight` plus a check mark badge, so selection never relies on color alone. The image is
 * `size + 2 * SELECTED_OVERLAY_PADDING` pixels square, centered on the marker. Colors are
 * concrete values read from the `--highlight` and `--highlight-foreground` tokens at setup.
 */
export function selectedOverlay(highlight: string, checkColor: string, size: number): string {
	const total = size + 2 * SELECTED_OVERLAY_PADDING;
	const c = total / 2;
	const ring = size / 2 + 2.5;
	const b = SELECTED_OVERLAY_PADDING;
	const bx = total - b;
	return `<svg width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${c}" cy="${c}" r="${ring}" fill="none" stroke="${highlight}" stroke-width="3"/>
    <circle cx="${bx}" cy="${b}" r="${b - 0.5}" fill="${highlight}" stroke="${checkColor}" stroke-width="1"/>
    <path d="M${bx - 2.5} ${b} l1.75 1.75 l3.25 -3.5" fill="none" stroke="${checkColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function asDataURI(svg: string): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
