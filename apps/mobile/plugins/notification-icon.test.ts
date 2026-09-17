import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import appConfig from '../app.config';

/**
 * The Android status bar icon must be one white glyph on transparency.
 *
 * Android draws a notification's small icon from its alpha channel alone: every
 * opaque pixel is painted white and the colour is discarded. So an asset that
 * is opaque edge to edge does not render as itself, it renders as a solid white
 * blob, and an asset with colour in it renders as if the colour were never
 * there. Both look deliberate.
 *
 * This is the failure the icon exists to fix. Before it, expo-notifications
 * fell back to the launcher icon, which has no alpha channel at all, and every
 * DoDone notification drew a plain white circle in the status bar.
 *
 * It fails silently and only on a device. Nothing in a build, a type-check or a
 * simulator screenshot reads the alpha channel of a drawable the system UI will
 * later flatten, which is the same reason `plugins/` is in this suite at all.
 * So the rule is asserted here, against whatever file the config actually
 * points at.
 */

interface Png {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** RGBA bytes, row-major, filters already undone. */
  pixels: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A minimal PNG reader for 8-bit RGBA, supporting all five scanline filters.
 *
 * Written out rather than pulled from a library because the repo has no image
 * dependency, and deliberately filter-complete rather than assuming filter 0:
 * the point of testing the file instead of the generator is that it still holds
 * when someone regenerates the asset with a different tool.
 */
function decodePng(file: Buffer): Png {
  expect(file.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6); // RGBA. Anything else has no alpha to cut from.

  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);

  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) value += paeth(a, b, c);
      pixels[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, bitDepth, colorType, pixels };
}

/** The `icon` the expo-notifications block in app.config.ts points at. */
function configuredIconPath(): string {
  const plugins = appConfig({ config: {} } as never).plugins ?? [];
  const entry = plugins.find(
    (p): p is [string, { icon?: string }] =>
      Array.isArray(p) && p[0] === 'expo-notifications'
  );
  expect(entry, 'app.config.ts must register the expo-notifications plugin').toBeDefined();
  const icon = entry![1]?.icon;
  expect(icon, 'the expo-notifications block must set an icon').toBeTruthy();
  return resolve(__dirname, '..', icon!);
}

describe('android notification icon', () => {
  const png = decodePng(readFileSync(configuredIconPath()));

  const pixel = (x: number, y: number) => {
    const o = (y * png.width + x) * 4;
    return {
      r: png.pixels[o],
      g: png.pixels[o + 1],
      b: png.pixels[o + 2],
      a: png.pixels[o + 3],
    };
  };

  it('is a square 96px source, the size expo resizes the density buckets from', () => {
    expect(png.width).toBe(96);
    expect(png.height).toBe(96);
  });

  it('is white wherever it is visible', () => {
    // A coloured icon is not rejected by anything in the build. It renders as
    // the silhouette of itself, so the colour is simply lost.
    const coloured: string[] = [];
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const { r, g, b, a } = pixel(x, y);
        if (a > 0 && !(r === 255 && g === 255 && b === 255)) {
          coloured.push(`(${x},${y}) rgb(${r},${g},${b})`);
        }
      }
    }
    expect(coloured.slice(0, 5)).toEqual([]);
  });

  it('has a transparent background, so it does not flatten to a blob', () => {
    // The four corners plus a real share of the canvas. An opaque square passes
    // every other assertion here and is exactly the bug: it is what the launcher
    // icon was, and it drew a plain white circle.
    for (const [x, y] of [
      [0, 0],
      [png.width - 1, 0],
      [0, png.height - 1],
      [png.width - 1, png.height - 1],
    ]) {
      expect(pixel(x, y).a, `corner (${x},${y}) must be transparent`).toBe(0);
    }

    let transparent = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        if (pixel(x, y).a === 0) transparent++;
      }
    }
    expect(transparent / (png.width * png.height)).toBeGreaterThan(0.3);
  });

  it('draws a glyph, and keeps it clear of the edges', () => {
    // The status bar gives the icon a 24dp box and sets the icons beside it
    // right against it, so the mark's round caps need the margin. 96px maps to
    // that 24dp, so a 4px inset is 1dp.
    let opaque = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        if (pixel(x, y).a > 0) {
          opaque++;
          expect(
            x >= 4 && x < png.width - 4 && y >= 4 && y < png.height - 4,
            `visible pixel (${x},${y}) is inside the margin`
          ).toBe(true);
        }
      }
    }
    expect(opaque).toBeGreaterThan(0.15 * png.width * png.height);
  });
});
