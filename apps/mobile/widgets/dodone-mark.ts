/**
 * DoDone brand mark as inline SVG, for use in home-screen widgets.
 *
 * `SvgWidget` from react-native-android-widget accepts a raw SVG string and
 * renders it through AndroidSVG, so widget artwork needs no bundled asset and
 * stays crisp at any launcher cell size. (The library's `IconWidget` is *not* a
 * substitute: it renders the icon name as text in a typeface the app must ship
 * itself — with no `material.ttf` in `assets/fonts`, `icon="add"` literally drew
 * the word "add" on the home screen.)
 *
 * The mark is the DoDone glyph from the app icon: a single round-capped stroke
 * that loops into a bowl and rises to the right, drawn twice — a faded trailing
 * copy plus the solid one.
 */

/** One glyph, authored on a 100×100 canvas. Loop first, then the ascender. */
const GLYPH = 'M54.5 49.7A10.3 10.3 0 1 0 56.6 65.9L80.1 32.2';

/** Offset of the faded trailing glyph from the solid one. */
const GHOST_OFFSET = 'translate(-22, -1)';

const STROKE_WIDTH = 11.2;

/**
 * The DoDone mark as `<g>` contents on the glyph's own 100×100 canvas.
 * Bounding box is roughly x 11.4→85.7, y 26.6→74.5.
 */
function glyph(color: string): string {
  const stroke =
    `fill="none" stroke="${color}" stroke-width="${STROKE_WIDTH}" ` +
    'stroke-linecap="round" stroke-linejoin="round"';
  return (
    `<path d="${GLYPH}" ${stroke} opacity="0.45" transform="${GHOST_OFFSET}"/>` +
    `<path d="${GLYPH}" ${stroke}/>`
  );
}

/**
 * The 1×1 quick-add tile: an indigo gradient squircle carrying the DoDone mark
 * with a white "+" badge in the corner — a branded button that reads as "add",
 * rather than the word "add" on a flat square.
 */
export function quickAddTileSvg(): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">',
    '<defs>',
    '<linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0" stop-color="#818cf8"/>',
    '<stop offset="1" stop-color="#5b55e0"/>',
    '</linearGradient>',
    '</defs>',
    '<rect x="0" y="0" width="120" height="120" rx="28" fill="url(#tile)"/>',
    // Soft top highlight, so the tile has some depth next to glossy app icons.
    '<rect x="0" y="0" width="120" height="120" rx="28" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>',
    `<g transform="translate(5.8, -0.1) scale(0.95)">${glyph('#ffffff')}</g>`,
    // "+" badge, bottom-right, clear of the mark and inside the corner radius.
    '<circle cx="91" cy="91" r="19" fill="#ffffff"/>',
    '<path d="M91 82.5V99.5M82.5 91H99.5" stroke="#4f46e5" stroke-width="7" stroke-linecap="round"/>',
    '</svg>',
  ].join('');
}

/** A standalone "+" glyph, sized to its own box. */
export function plusSvg(color: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    `<path d="M12 4.5V19.5M4.5 12H19.5" stroke="${color}" stroke-width="3" stroke-linecap="round"/>` +
    '</svg>'
  );
}

/** The DoDone mark on its own, transparent background — for light surfaces. */
export function dodoneMarkSvg(color: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="8 24 80 54">' +
    glyph(color) +
    '</svg>'
  );
}
