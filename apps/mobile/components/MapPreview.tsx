/**
 * A small map under a picked place: the pin, the region it will trigger in,
 * and where you are relative to both.
 *
 * Coordinates are unreadable and a geofence is unforgiving — 200 m around the
 * wrong side of a dual carriageway never fires, and nothing in a "Pinned at
 * 51.5074, -0.1278" line would have told you. So this draws it.
 *
 * Deliberately not `react-native-maps`: that's a native module, which means a
 * fresh dev-client build and a Google Maps API key before anyone can see a
 * pixel. Raster tiles are just images, so this works in the build people
 * already have. What it gives up is interaction — no panning, no dragging the
 * pin — which is why the radius chips and the search list stay the way you
 * adjust a place. See lib/map-tiles.ts for the projection.
 *
 * The tiles come from OpenStreetMap's public servers, whose usage policy this
 * has to keep: attribution is drawn over the corner, requests identify the app
 * by User-Agent, and a preview is a handful of tiles shown when a user picks a
 * place — not bulk downloading. Swap `baseUrl` for a paid tile host if that
 * ever stops being true.
 */

import React, { useMemo, useState } from 'react';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  buildTileGrid,
  metersPerPixel,
  offsetPixels,
  zoomForRadius,
  type LatLng,
} from '@/lib/map-tiles';

/** Identifies the app to the tile server, as its usage policy requires. */
const TILE_USER_AGENT = `DoDone/1.0 (${Platform.OS}; +https://github.com/byebrianwong/do-done)`;

const DEFAULT_HEIGHT = 150;

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
  /** Caption under the map — usually the address of the pin. */
  label?: string;
}) {
  // Width has to be measured: the sheet is inset by paddings this component
  // has no way to know, and a tile grid built for the wrong width is centred
  // on the wrong point.
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };

  const view = useMemo(() => {
    if (width <= 0) return null;
    const zoom = zoomForRadius(radiusMeters, center.latitude, width);
    const scale = metersPerPixel(center.latitude, zoom);
    return {
      zoom,
      tiles: buildTileGrid({ center, zoom, width, height }),
      radiusPx: radiusMeters / scale,
      you: you ? offsetPixels(center, you, zoom) : null,
    };
  }, [center, radiusMeters, you, width, height]);

  // A failed tile fetch is silent — the <Image> just never paints — so fall
  // back to something that at least says where the pin is.
  if (failed) {
    return (
      <View style={[styles.fallback, { height }]} onLayout={onLayout}>
        <Text style={styles.fallbackPin}>📍</Text>
        <Text style={styles.fallbackText}>
          {label ||
            `${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)}`}
        </Text>
        <Text style={styles.fallbackHint}>Map preview unavailable offline</Text>
      </View>
    );
  }

  return (
    <View style={[styles.frame, { height }]} onLayout={onLayout}>
      {view ? (
        <>
          {view.tiles.map((tile) => (
            <Image
              key={`${tile.z}/${tile.x}/${tile.y}`}
              source={{
                uri: tile.url,
                headers: { 'User-Agent': TILE_USER_AGENT },
              }}
              onError={() => setFailed(true)}
              style={{
                position: 'absolute',
                left: tile.left,
                top: tile.top,
                width: tile.size,
                height: tile.size,
              }}
            />
          ))}

          {/* The region itself. Centred on the pin, so it reads as "inside
              here counts" rather than as decoration around a marker. */}
          <View
            pointerEvents="none"
            style={[
              styles.radius,
              {
                width: view.radiusPx * 2,
                height: view.radiusPx * 2,
                borderRadius: view.radiusPx,
                left: width / 2 - view.radiusPx,
                top: height / 2 - view.radiusPx,
              },
            ]}
          />

          {view.you ? (
            <View
              pointerEvents="none"
              style={[
                styles.you,
                {
                  left: width / 2 + view.you.dx - YOU_SIZE / 2,
                  top: height / 2 + view.you.dy - YOU_SIZE / 2,
                },
              ]}
            />
          ) : null}

          <Text pointerEvents="none" style={styles.pin}>
            📍
          </Text>

          <Text pointerEvents="none" style={styles.attribution}>
            © OpenStreetMap
          </Text>
        </>
      ) : null}
    </View>
  );
}

const YOU_SIZE = 14;

const styles = StyleSheet.create({
  frame: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  radius: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#6366f1',
    backgroundColor: 'rgba(99,102,241,0.16)',
  },
  you: {
    position: 'absolute',
    width: YOU_SIZE,
    height: YOU_SIZE,
    borderRadius: YOU_SIZE / 2,
    backgroundColor: '#2563eb',
    borderWidth: 2,
    borderColor: '#fff',
  },
  // The pin's point is its bottom edge, so it sits half a glyph above centre.
  pin: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -22,
    fontSize: 22,
  },
  attribution: {
    position: 'absolute',
    right: 4,
    bottom: 2,
    fontSize: 9,
    color: '#374151',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 3,
    borderRadius: 3,
    overflow: 'hidden',
  },

  fallback: {
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 12,
  },
  fallbackPin: { fontSize: 20 },
  fallbackText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '600',
    textAlign: 'center',
  },
  fallbackHint: { fontSize: 11, color: '#9ca3af' },
});
