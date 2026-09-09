/**
 * Emits apps/mobile/assets/images/notification-icon.png, the Android status
 * bar icon.
 *
 *   node tools/notification-icon/emit.mjs
 *
 * Android draws a notification's small icon as a **silhouette cut from its
 * alpha channel**: every opaque pixel becomes white, and the colour is thrown
 * away. So the source has to be one white glyph on transparency, and the app
 * icon can never stand in for it. `icon.png` has no alpha channel at all, and
 * the adaptive launcher icon is opaque edge to edge, which is why the status
 * bar showed a plain white circle.
 *
 * There is no image library in this repo, so the glyph is rasterised here from
 * its own path data. The maths is a signed distance field: sample the stroke's
 * centreline into a polyline, then shade each pixel by its distance to that
 * line. Round caps and round joins are what that gives you for free, which is
 * exactly how the mark is stroked.
 *
 * The glyph is the solid half of the DoDone mark in
 * apps/mobile/widgets/dodone-mark.ts. That file is the source of truth for the
 * shape, and this one restates it because a .mjs script cannot import a .ts
 * module without a loader. The faded trailing copy is dropped on purpose: a
 * silhouette has no opacity to render it with, so at 24dp it would merge into
 * the solid glyph as one unreadable blob.
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

const OUT = join(
  new URL(".", import.meta.url).pathname,
  "../../apps/mobile/assets/images/notification-icon.png"
);

// ── The glyph, on its own 100x100 canvas ───────────────
// "M54.5 49.7 A10.3 10.3 0 1 0 56.6 65.9 L80.1 32.2", stroked at 11.2 with
// round caps and joins. Kept as numbers rather than a path string so this file
// needs no SVG parser.
const ARC = {
  from: [54.5, 49.7],
  to: [56.6, 65.9],
  r: 10.3,
  largeArc: true,
  sweep: false,
};
const LINE_TO = [80.1, 32.2];
const STROKE_WIDTH = 11.2;

/** Output canvas, and the margin the glyph keeps inside it. */
const SIZE = 96;
const MARGIN = 7;

/**
 * SVG arc endpoint to centre parameterisation (W3C SVG 1.1, F.6.5), for the
 * zero-rotation equal-radii case this glyph uses. Returns the centre and the
 * angle sweep, which is all the sampler needs.
 */
function arcCenter({ from, to, r, largeArc, sweep }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;

  // F.6.6: grow the radius if the endpoints are further apart than it allows.
  const lambda = (dx * dx + dy * dy) / (r * r);
  const rr = lambda > 1 ? r * Math.sqrt(lambda) : r;

  const num = rr * rr * rr * rr - rr * rr * (dy * dy + dx * dx);
  const den = rr * rr * dy * dy + rr * rr * dx * dx;
  const coef =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rr * dy) / rr;
  const cyp = (-coef * rr * dx) / rr;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;

  let start = Math.atan2(y1 - cy, x1 - cx);
  let end = Math.atan2(y2 - cy, x2 - cx);
  let delta = end - start;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;

  return { cx, cy, r: rr, start, delta };
}

/** The stroke's centreline, densely enough sampled that chords never show. */
function centerline() {
  const { cx, cy, r, start, delta } = arcCenter(ARC);
  const steps = 256;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = start + (delta * i) / steps;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  pts.push(LINE_TO);
  return pts;
}

/** Distance from a point to a segment. */
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

/** RGBA pixels: white everywhere, alpha from the distance field. */
function render() {
  const pts = centerline();
  const half = STROKE_WIDTH / 2;

  // The stroked shape's bounds are the centreline's, grown by half the width.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x - half);
    minY = Math.min(minY, y - half);
    maxX = Math.max(maxX, x + half);
    maxY = Math.max(maxY, y + half);
  }

  // Fit those bounds into the margined box, preserving the aspect ratio.
  const box = SIZE - MARGIN * 2;
  const scale = Math.min(box / (maxX - minX), box / (maxY - minY));
  const offX = (SIZE - (maxX - minX) * scale) / 2 - minX * scale;
  const offY = (SIZE - (maxY - minY) * scale) / 2 - minY * scale;

  const device = pts.map(([x, y]) => [x * scale + offX, y * scale + offY]);
  const radius = half * scale;

  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let d = Infinity;
      for (let i = 1; i < device.length; i++) {
        d = Math.min(d, distToSegment(px, py, device[i - 1], device[i]));
        if (d + radius < 0) break;
      }
      // One pixel of coverage either side of the edge is the antialiasing.
      const cover = Math.max(0, Math.min(1, radius - d + 0.5));
      const o = (y * SIZE + x) * 4;
      rgba[o] = 255;
      rgba[o + 1] = 255;
      rgba[o + 2] = 255;
      rgba[o + 3] = Math.round(cover * 255);
    }
  }
  return rgba;
}

// ── PNG container ──────────────────────────────────────

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function png(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // Each scanline is prefixed with its filter type; 0 is "none".
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(OUT, png(render()));
console.log(`wrote ${OUT}`);
