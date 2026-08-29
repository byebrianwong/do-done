/**
 * Tests for the map preview's projection.
 *
 * A tile grid fails convincingly: shifted by one tile it still draws a map, of
 * a street a few hundred metres away, and nothing about it looks broken. These
 * pin the three things that would produce that — the projection itself, the
 * centring, and the pixel offset the pin and the "you are here" dot are placed
 * with.
 */
import { describe, it, expect } from "vitest";
import {
  buildTileGrid,
  metersPerPixel,
  offsetPixels,
  projectToTile,
  TILE_SIZE,
  zoomForRadius,
} from "./map-tiles.js";

const LONDON = { latitude: 51.5074, longitude: -0.1278 };

describe("projectToTile", () => {
  it("puts the origin at the middle of the world at zoom 0", () => {
    const { x, y } = projectToTile({ latitude: 0, longitude: 0 }, 0);
    expect(x).toBeCloseTo(0.5, 6);
    expect(y).toBeCloseTo(0.5, 6);
  });

  it("lands on the tile the OSM wiki's own formula gives", () => {
    // Central London at z12 is 12/2046/1362 — worth pinning to a hand-checked
    // number, since an off-by-one tile still renders a perfectly good map.
    const { x, y } = projectToTile(LONDON, 12);
    expect(Math.floor(x)).toBe(2046);
    expect(Math.floor(y)).toBe(1362);
  });

  it("clamps at the pole rather than diverging to infinity", () => {
    // tan(90°) is unbounded, so an unclamped projection returns Infinity here
    // and every downstream offset becomes NaN.
    const { y } = projectToTile({ latitude: 90, longitude: 0 }, 4);
    expect(Number.isFinite(y)).toBe(true);
    expect(Math.abs(y)).toBeLessThan(1e-6); // pinned to the top edge
  });
});

describe("buildTileGrid", () => {
  it("centres the view on the point, not on the tile containing it", () => {
    const width = 300;
    const height = 160;
    const tiles = buildTileGrid({ center: LONDON, zoom: 15, width, height });

    const { x, y } = projectToTile(LONDON, 15);
    const centreTile = tiles.find(
      (t) => t.x === Math.floor(x) && t.y === Math.floor(y)
    );
    expect(centreTile).toBeDefined();

    // The centre coordinate must land on the middle pixel of the preview.
    const pinX = centreTile!.left + (x - Math.floor(x)) * TILE_SIZE;
    const pinY = centreTile!.top + (y - Math.floor(y)) * TILE_SIZE;
    expect(pinX).toBeCloseTo(width / 2, 6);
    expect(pinY).toBeCloseTo(height / 2, 6);
  });

  it("covers the whole preview with no gaps", () => {
    const width = 300;
    const height = 160;
    const tiles = buildTileGrid({ center: LONDON, zoom: 16, width, height });

    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + t.size))).toBeGreaterThanOrEqual(
      width
    );
    expect(Math.max(...tiles.map((t) => t.top + t.size))).toBeGreaterThanOrEqual(
      height
    );
  });

  it("wraps x across the date line instead of asking for a tile that isn't there", () => {
    const tiles = buildTileGrid({
      center: { latitude: 0, longitude: 179.99 },
      zoom: 4,
      width: 300,
      height: 160,
    });
    const n = 2 ** 4;
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(n);
    }
    // Both edges of the world are represented, which is what this checks.
    expect(tiles.some((t) => t.x === n - 1)).toBe(true);
    expect(tiles.some((t) => t.x === 0)).toBe(true);
  });

  it("drops rows past the north edge, where no tile exists", () => {
    const tiles = buildTileGrid({
      center: { latitude: 85, longitude: 0 },
      zoom: 2,
      width: 300,
      height: 300,
    });
    for (const tile of tiles) {
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(4);
    }
  });

  it("builds the URL a tile server expects", () => {
    const [tile] = buildTileGrid({
      center: LONDON,
      zoom: 12,
      width: 1,
      height: 1,
      baseUrl: "https://example.test",
    });
    expect(tile.url).toBe(`https://example.test/12/${tile.x}/${tile.y}.png`);
  });
});

describe("framing", () => {
  it("zooms so the region fills most of the width, whatever its radius", () => {
    const width = 300;
    for (const radius of [100, 200, 500, 1000]) {
      const zoom = zoomForRadius(radius, LONDON.latitude, width);
      const diameterPx = (radius * 2) / metersPerPixel(LONDON.latitude, zoom);
      expect(diameterPx).toBeGreaterThan(width * 0.4);
      expect(diameterPx).toBeLessThan(width);
    }
  });

  it("stays within zoom levels that have tiles", () => {
    expect(zoomForRadius(5, LONDON.latitude, 300)).toBeLessThanOrEqual(19);
    expect(zoomForRadius(500_000, LONDON.latitude, 300)).toBeGreaterThanOrEqual(
      10
    );
  });
});

describe("offsetPixels", () => {
  it("is zero for the centre itself", () => {
    expect(offsetPixels(LONDON, LONDON, 16)).toEqual({ dx: 0, dy: 0 });
  });

  it("puts north up and east right", () => {
    const north = { latitude: LONDON.latitude + 0.002, longitude: LONDON.longitude };
    const east = { latitude: LONDON.latitude, longitude: LONDON.longitude + 0.002 };
    expect(offsetPixels(LONDON, north, 16).dy).toBeLessThan(0);
    expect(offsetPixels(LONDON, east, 16).dx).toBeGreaterThan(0);
  });

  it("matches the scale it was drawn at", () => {
    const zoom = 16;
    const metres = 300;
    // 300 m due east, converted through the local metres-per-degree.
    const east = {
      latitude: LONDON.latitude,
      longitude:
        LONDON.longitude +
        metres / (111_320 * Math.cos((LONDON.latitude * Math.PI) / 180)),
    };
    const { dx } = offsetPixels(LONDON, east, zoom);
    expect(dx).toBeCloseTo(metres / metersPerPixel(LONDON.latitude, zoom), 0);
  });
});
