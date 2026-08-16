"use client";

/**
 * A small map under a picked place: the pin, the region it will trigger in,
 * and where you are relative to both.
 *
 * The web twin of `apps/mobile/components/MapPreview.tsx`, drawing the same
 * grid from the same projection (`map-tiles.ts` in `@do-done/shared`). Raster
 * tiles are plain images, so this needs no map SDK and no API key — which on
 * web buys less than it does on mobile, but it does mean the two previews are
 * the same picture rather than two different opinions about where the region
 * ends.
 *
 * Coordinates are unreadable and a geofence is unforgiving: 200 m around the
 * wrong side of a dual carriageway never fires, and nothing in a "51.5074,
 * -0.1278" line would have told you. What it gives up is interaction — no
 * panning, no dragging the pin — so the radius buttons and the search list stay
 * the way a place is adjusted.
 *
 * The tiles come from OpenStreetMap's public servers. Their usage policy wants
 * requests identified and traffic incidental; a browser sends its own
 * User-Agent and a Referer naming this app, and a preview is a handful of tiles
 * shown when someone picks a place. Attribution is drawn in the corner, as the
 * licence requires. Swap `baseUrl` for a paid tile host if that stops being
 * true.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTileGrid,
  metersPerPixel,
  offsetPixels,
  zoomForRadius,
  type LatLng,
} from "@do-done/shared";

const DEFAULT_HEIGHT = 150;
const YOU_SIZE = 14;

export function MapPreview({
  center,
  radiusMeters,
  you,
  height = DEFAULT_HEIGHT,
  label,
}: {
  center: LatLng;
  radiusMeters: number;
  /** The user's own position, when known. Drawn as the familiar blue dot. */
  you?: LatLng | null;
  height?: number;
  /** Shown instead of the map if the tiles can't be fetched. */
  label?: string;
}) {
  // Width has to be measured: this sits inside paddings the component has no
  // way to know, and a tile grid built for the wrong width is centred on the
  // wrong point.
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Which view the tiles failed for, rather than a bare "they failed".
  // Deriving it means a new place — or a new radius, which is a new zoom and
  // so a new set of tiles — is a fresh attempt automatically. A boolean would
  // need an effect to clear it, and one offline moment would otherwise leave
  // the fallback up for the rest of the session.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const viewKey = `${center.latitude},${center.longitude},${radiusMeters}`;
  const failed = failedFor === viewKey;

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      setWidth((current) => (current === next ? current : next));
    };
    // Measured once directly, *then* observed. The direct call is not
    // redundant with the observer's initial delivery: a ResizeObserver that
    // never fires leaves the width at 0, and a width of 0 draws no tiles at
    // all — an empty grey box with nothing in the console. Whereas the
    // rectangle is there to be read the moment the element is in the layout,
    // so the map's first frame doesn't depend on an API delivering.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const view = useMemo(() => {
    if (width <= 0) return null;
    // The shorter side, so the whole region fits: this frame is much wider
    // than it is tall, and a circle framed to the width would have its top and
    // bottom cut off by it.
    const zoom = zoomForRadius(
      radiusMeters,
      center.latitude,
      Math.min(width, height)
    );
    const scale = metersPerPixel(center.latitude, zoom);
    return {
      zoom,
      tiles: buildTileGrid({ center, zoom, width, height }),
      radiusPx: radiusMeters / scale,
      you: you ? offsetPixels(center, you, zoom) : null,
    };
  }, [center, radiusMeters, you, width, height]);

  if (failed) {
    return (
      <div
        ref={frame}
        style={{ height }}
        className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-neutral-100 px-3 text-center dark:bg-neutral-800"
      >
        <span aria-hidden className="text-[20px]">
          📍
        </span>
        <span className="text-[12px] font-semibold text-neutral-700 dark:text-neutral-200">
          {label ||
            `${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)}`}
        </span>
        <span className="text-[11px] text-neutral-400">
          Map preview unavailable
        </span>
      </div>
    );
  }

  return (
    <div
      ref={frame}
      style={{ height }}
      role="img"
      aria-label={
        label
          ? `Map of ${label}, showing the ${radiusMeters} metre reminder area`
          : `Map showing the ${radiusMeters} metre reminder area`
      }
      className="relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 dark:border-neutral-700"
    >
      {view ? (
        <>
          {view.tiles.map((tile) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${tile.z}/${tile.x}/${tile.y}`}
              src={tile.url}
              alt=""
              aria-hidden
              draggable={false}
              onError={() => setFailedFor(viewKey)}
              style={{
                position: "absolute",
                left: tile.left,
                top: tile.top,
                width: tile.size,
                height: tile.size,
              }}
            />
          ))}

          {/* The region itself. Centred on the pin, so it reads as "inside
              here counts" rather than as decoration around a marker. */}
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-full border-2 border-indigo-500 bg-indigo-500/15"
            style={{
              width: view.radiusPx * 2,
              height: view.radiusPx * 2,
              left: width / 2 - view.radiusPx,
              top: height / 2 - view.radiusPx,
            }}
          />

          {view.you ? (
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-full border-2 border-white bg-blue-600"
              style={{
                width: YOU_SIZE,
                height: YOU_SIZE,
                left: width / 2 + view.you.dx - YOU_SIZE / 2,
                top: height / 2 + view.you.dy - YOU_SIZE / 2,
              }}
            />
          ) : null}

          {/* The pin's point is its bottom edge, so it sits half a glyph above
              centre — otherwise it marks a spot a little north of the place. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 text-[22px] leading-none"
            style={{ marginTop: -22 }}
          >
            📍
          </span>

          <span className="pointer-events-none absolute bottom-0.5 right-1 rounded bg-white/70 px-1 text-[9px] text-neutral-700">
            © OpenStreetMap
          </span>
        </>
      ) : null}
    </div>
  );
}
