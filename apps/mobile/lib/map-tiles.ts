/**
 * Slippy-map arithmetic for the little map preview under a picked place.
 *
 * A pair of coordinates tells you nothing about whether the pin landed on the
 * right side of the road, which is exactly the mistake a geofence punishes.
 * The preview answers that, and it does so without a native map: raster tiles
 * are plain images, so this is React Native `<Image>` and no new native module,
 * no API key, and no rebuild of the dev client.
 *
 * Everything here is the Web-Mercator projection every tile server shares
 * (OSM, and anything else with a `{z}/{x}/{y}` URL), kept apart from the
 * component so the projection can be tested in node — the one part of a map
 * that is arithmetic rather than pixels, and the one part that fails in a way
 * you can't see: a grid that's off by a tile still draws a perfectly plausible
 * map of the wrong street.
 */

export const TILE_SIZE = 256;

/**
 * OpenStreetMap's public tile servers. Their usage policy allows incidental
 * use like this (a handful of tiles when a user picks a place) and requires
 * attribution — see MapPreview, which draws it — and a User-Agent that
 * identifies the app, which the component sets on every request.
 */
export const OSM_TILE_URL = "https://tile.openstreetmap.org";

/** Web Mercator can't represent the poles; this is where the square ends. */
const MAX_LATITUDE = 85.05112878;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Tile {
  z: number;
  x: number;
  y: number;
  url: string;
  /** Position within the preview, in pixels from its top-left corner. */
  left: number;
  top: number;
  size: number;
}

/** Metres covered by one screen pixel — the scale bar, minus the bar. */
export function metersPerPixel(latitude: number, zoom: number): number {
  const clamped = clampLatitude(latitude);
  return (
    (156_543.03392 * Math.cos((clamped * Math.PI) / 180)) / Math.pow(2, zoom)
  );
}

/**
 * The zoom that makes a radius fill `fraction` of the preview's width.
 *
 * Framing is the whole job of the preview: at a fixed zoom a 100 m region is a
 * dot and a 1 km one runs off the edge, and neither tells you whether the pin
 * is on the right street. Clamped to sane tile zooms — past 19 most of the
 * world has no tiles at all, and below 10 you're looking at a county.
 */
export function zoomForRadius(
  radiusMeters: number,
  latitude: number,
  viewWidthPx: number,
  fraction = 0.7
): number {
  const wantedMetersPerPixel =
    (radiusMeters * 2) / Math.max(viewWidthPx * fraction, 1);
  const atZoomZero = metersPerPixel(latitude, 0);
  const zoom = Math.log2(atZoomZero / wantedMetersPerPixel);
  return Math.max(10, Math.min(19, Math.round(zoom)));
}

/** Fractional tile coordinates — the projection itself. */
export function projectToTile(
  point: LatLng,
  zoom: number
): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const lat = (clampLatitude(point.latitude) * Math.PI) / 180;
  return {
    x: ((point.longitude + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n,
  };
}

/**
 * Where `point` sits relative to `center`, in preview pixels — positive x is
 * right, positive y is *down*, matching how the view is laid out rather than
 * how a map is described.
 */
export function offsetPixels(
  center: LatLng,
  point: LatLng,
  zoom: number
): { dx: number; dy: number } {
  const c = projectToTile(center, zoom);
  const p = projectToTile(point, zoom);
  return { dx: (p.x - c.x) * TILE_SIZE, dy: (p.y - c.y) * TILE_SIZE };
}

/**
 * The tiles needed to fill a `width × height` preview centred on `center`,
 * each with the offset it should be drawn at.
 *
 * Tiles are laid out from the fractional position of the centre, so the pin
 * lands in the middle of the view rather than in the middle of whichever tile
 * happens to contain it.
 */
export function buildTileGrid({
  center,
  zoom,
  width,
  height,
  baseUrl = OSM_TILE_URL,
}: {
  center: LatLng;
  zoom: number;
  width: number;
  height: number;
  baseUrl?: string;
}): Tile[] {
  const n = Math.pow(2, zoom);
  const { x: cx, y: cy } = projectToTile(center, zoom);

  // Pixel coordinates of the view's top-left corner in the whole-world plane.
  const originX = cx * TILE_SIZE - width / 2;
  const originY = cy * TILE_SIZE - height / 2;

  const firstX = Math.floor(originX / TILE_SIZE);
  const firstY = Math.floor(originY / TILE_SIZE);
  const lastX = Math.floor((originX + width - 1) / TILE_SIZE);
  const lastY = Math.floor((originY + height - 1) / TILE_SIZE);

  const tiles: Tile[] = [];
  for (let ty = firstY; ty <= lastY; ty++) {
    // Above the north edge or below the south edge there is no tile to ask
    // for; asking anyway is a 404 per pan and a grey square either way.
    if (ty < 0 || ty >= n) continue;
    for (let tx = firstX; tx <= lastX; tx++) {
      // Longitude wraps, so x does too — at the date line the row continues
      // from the other side of the world rather than running out.
      const wrappedX = ((tx % n) + n) % n;
      tiles.push({
        z: zoom,
        x: wrappedX,
        y: ty,
        url: `${baseUrl}/${zoom}/${wrappedX}/${ty}.png`,
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
        size: TILE_SIZE,
      });
    }
  }
  return tiles;
}

function clampLatitude(latitude: number): number {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
}
