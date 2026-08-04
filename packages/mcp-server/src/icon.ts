/**
 * Branding for the server's `Implementation` block — the name, title and icon a
 * client shows in its connector list.
 *
 * Without an `icons` entry a client has nothing to draw and falls back to its
 * own generic placeholder, which is why the connector showed a stock star
 * rather than the DoDone mark.
 *
 * Two forms are offered, because the two transports live in different places:
 *
 *   - The hosted PNG at `<baseUrl>/icon.png` — the same 512×512 app icon the
 *     web app serves as its favicon, so the connector matches the site. It is
 *     reachable anonymously: the auth proxy's matcher excludes `.png`.
 *   - An inline `data:` SVG, which needs no host at all. This is the only form
 *     available to the stdio server, which has no public URL to point at.
 *
 * Clients pick from the list, so the hosted PNG leads (a plain https image is
 * the most universally rendered thing) with the self-contained SVG behind it.
 */

/** The wordless DoDone glyph, authored on a 100×100 canvas: loop, then ascender. */
const GLYPH = "M54.5 49.7A10.3 10.3 0 1 0 56.6 65.9L80.1 32.2";

/** Offset of the faded trailing glyph from the solid one. */
const GHOST_OFFSET = "translate(-22, -1)";

const STROKE_WIDTH = 11.2;

/**
 * The app icon as SVG: the mark in white on the indigo gradient squircle.
 *
 * Authored on a 128×128 canvas; the glyph's own 100×100 canvas is scaled 1.15
 * and nudged so its bounding box (x 11.4→85.7, y 26.6→74.5) lands centred.
 *
 * This mirrors `apps/web/src/app/icon.png` and the mobile widget artwork in
 * `apps/mobile/widgets/dodone-mark.ts` — change the mark in one and the others
 * need the same edit.
 */
const ICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">',
  "<defs>",
  '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
  '<stop offset="0" stop-color="#818cf8"/>',
  '<stop offset="1" stop-color="#5b55e0"/>',
  "</linearGradient>",
  "</defs>",
  '<rect width="128" height="128" rx="30" fill="url(#g)"/>',
  '<g transform="translate(8.2, 5.9) scale(1.15)" fill="none" stroke="#ffffff"',
  ` stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">`,
  `<path d="${GLYPH}" opacity="0.45" transform="${GHOST_OFFSET}"/>`,
  `<path d="${GLYPH}"/>`,
  "</g>",
  "</svg>",
].join("");

/**
 * The mark as a `data:` URI. Percent-encoded rather than base64 so the markup
 * stays legible in a protocol trace — and so the `#` in each colour survives,
 * which unencoded would truncate the URI at a fragment.
 */
export const DODONE_ICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`;

export interface McpIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
}

/**
 * Icons to advertise, best-supported first.
 *
 * @param baseUrl Public origin of the web app, when the caller has one. Omit it
 *   (stdio) and only the self-contained SVG is offered.
 */
export function dodoneIcons(baseUrl?: string): McpIcon[] {
  const icons: McpIcon[] = [];

  if (baseUrl) {
    icons.push({
      src: `${baseUrl.replace(/\/+$/, "")}/icon.png`,
      mimeType: "image/png",
      sizes: ["512x512"],
    });
  }

  icons.push({
    src: DODONE_ICON_DATA_URI,
    mimeType: "image/svg+xml",
    sizes: ["any"],
  });

  return icons;
}
