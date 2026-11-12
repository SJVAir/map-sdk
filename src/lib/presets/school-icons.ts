/*
 * The `school` and `baby` glyphs below are Lucide's (lucide.dev, version 1.60.0), embedded as
 * path data so markers can be drawn into GL images. Neither is one of Lucide's Feather-derived
 * icons. Lucide's license:
 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/** Which badge a site gets: schools (public and private alike) or child care. */
export type BadgeKind = "school" | "child-care";

/** `child_care` is child care; every other type, including one a newer server adds, a school. */
export function badgeKindOf(type: string): BadgeKind {
	return type === "child_care" ? "child-care" : "school";
}

/** The badge's size in pixels: inside the focus ring's 11.5px inner casing edge. */
export const SCHOOL_BADGE_SIZE = 20;

// The user's choice (2026-11-12): a school-house pentagon, in a 24-unit box.
const BADGE_PATH = "M12 1.5 L22.5 9.5 V22.5 H1.5 V9.5 Z";

const GLYPHS: Record<BadgeKind, string[]> = {
	school: [
		'<path d="M14 21v-3a2 2 0 0 0-4 0v3"/>',
		'<path d="M18 4.933V21"/>',
		'<path d="m4 6 7.106-3.79a2 2 0 0 1 1.788 0L20 6"/>',
		'<path d="m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11"/>',
		'<path d="M6 4.933V21"/>',
		'<circle cx="12" cy="9" r="2"/>'
	],
	"child-care": [
		'<path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/>',
		'<path d="M15 12h.01"/>',
		'<path d="M19.38 6.813A9 9 0 0 1 20.8 10.2a2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
		'<path d="M9 12h.01"/>'
	]
};

/** The token and its fixed fallback for each kind (the user's decision, 2026-11-12). */
const TOKENS: Record<BadgeKind, string> = {
	school: "var(--school-marker, #5a6b7b)",
	"child-care": "var(--child-care-marker, #1c9099)"
};

/** The badge's shapes after its fill: white outline, faint dark edge, then the white glyph. */
function inner(kind: BadgeKind, fill: string): string {
	return (
		`<path d="${BADGE_PATH}" ${fill} stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>` +
		`<path d="${BADGE_PATH}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width=".6" stroke-linejoin="round"/>` +
		`<g transform="translate(4 7) scale(${16 / 24})" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">` +
		GLYPHS[kind].join("") +
		"</g>"
	);
}

/** A standalone SVG of the badge filled with `fill` (a concrete color), for a GL image. */
export function schoolBadge(kind: BadgeKind, fill: string, size = SCHOOL_BADGE_SIZE): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-1 -1 26 26">${inner(kind, `fill="${fill}"`)}</svg>`;
}

/**
 * The badge as inline DOM markup, decorative, filled from its token (with the fixed fallback) so
 * a legend follows the host's override.
 */
export function schoolBadgeMarkup(kind: BadgeKind, size: number): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-1 -1 26 26" aria-hidden="true" focusable="false">${inner(kind, `style="fill: ${TOKENS[kind]}"`)}</svg>`;
}
