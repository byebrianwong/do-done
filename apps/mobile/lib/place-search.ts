/**
 * Type-ahead place search.
 *
 * The old create-a-place flow asked for a name, then an address, then made you
 * press "Find" to turn that address into a pin. Three fields and a round-trip
 * to describe "the Target down the road". What people actually type is a few
 * letters and a house number, and what they want back is the full address to
 * tap — so this module answers a partial query with complete, tappable places.
 *
 * **Provider: Photon** (photon.komoot.io), OpenStreetMap data, no API key.
 * Two reasons it and not the obvious alternatives:
 *
 *  - `expo-location`'s `geocodeAsync` can't do this. It returns coordinates and
 *    nothing else — no label, no ranking — so there is nothing to *show* in a
 *    suggestion list. It stays the fallback for "an address I typed in full".
 *  - Nominatim's usage policy explicitly forbids autocomplete. Photon exists
 *    precisely for search-as-you-type and is the same underlying data.
 *
 * Keyless means fair use is on us: callers debounce, ask for 3+ characters,
 * and cap `limit`. Nothing here retries.
 *
 * No React Native imports, on purpose — everything below is plain fetch and
 * arithmetic, so it runs in the node test suite where the rest of the location
 * stack can't.
 */

const PHOTON_ENDPOINT = "https://photon.komoot.io/api";

/** DB constraints on `locations` — a suggestion has to fit in a row. */
const MAX_NAME = 200;
const MAX_ADDRESS = 500;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface PlaceSuggestion extends Coordinates {
  /** Stable within one result set; used as a list key and for de-duping. */
  id: string;
  /** What the row leads with: "Target", or the street line for a plain address. */
  name: string;
  /** The full address under the name. Empty when the provider gave us nothing. */
  address: string;
  /** Present only when we knew where the user was when searching. */
  distanceMeters?: number;
}

export class PlaceSearchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "PlaceSearchError";
  }
}

export interface PlaceSearchOptions {
  /** Bias results towards here, and label each row with its distance. */
  near?: Coordinates | null;
  limit?: number;
  signal?: AbortSignal;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | number | undefined>;
}

/**
 * Search places matching a partial query.
 *
 * Returns the provider's ranking untouched. It already folds distance into
 * relevance when biased, and re-sorting purely by distance is worse than it
 * sounds: for "target" it would float a *closer* street called Target Lane
 * above the shop two roads over. Each row carries its own distance instead, so
 * "the nearest one" is a thing the eye picks rather than a thing we guess.
 */
export async function searchPlaces(
  query: string,
  options: PlaceSearchOptions = {}
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (!q) return [];

  const { near, limit = 8, signal, fetchImpl = fetch } = options;

  const params = new URLSearchParams({ q, limit: String(limit) });
  if (near) {
    params.set("lat", String(near.latitude));
    params.set("lon", String(near.longitude));
  }

  let response: Response;
  try {
    response = await fetchImpl(`${PHOTON_ENDPOINT}?${params.toString()}`, {
      signal: signal ?? null,
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    // An abort is the caller superseding its own request, not a failure —
    // let it through untouched so the UI can tell the two apart.
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new PlaceSearchError("Place search could not reach the network", e);
  }

  if (!response.ok) {
    throw new PlaceSearchError(`Place search failed (${response.status})`);
  }

  let body: { features?: PhotonFeature[] };
  try {
    body = (await response.json()) as { features?: PhotonFeature[] };
  } catch (e) {
    throw new PlaceSearchError("Place search returned something unreadable", e);
  }

  const seen = new Set<string>();
  const results: PlaceSuggestion[] = [];

  for (const feature of body.features ?? []) {
    const suggestion = toSuggestion(feature, near ?? null);
    if (!suggestion) continue;
    // Photon can return the same place twice — once as the POI, once as the
    // building it sits in. Same label, same spot, one row.
    const key = `${suggestion.name}|${suggestion.address}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(suggestion);
  }

  return results;
}

/**
 * Turn one Photon feature into a row, or null when it isn't one.
 *
 * The label rules are what make the list scannable: a POI leads with its own
 * name and repeats nothing underneath, while a plain address leads with its
 * street line and puts the town under it.
 */
export function toSuggestion(
  feature: PhotonFeature,
  near: Coordinates | null = null
): PlaceSuggestion | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  // GeoJSON is [longitude, latitude] — the one ordering everybody gets wrong.
  const [longitude, latitude] = coords;
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const props = feature.properties ?? {};
  const str = (key: string): string => {
    const value = props[key];
    return typeof value === "string" ? value.trim() : "";
  };

  const streetLine = [str("housenumber"), str("street")]
    .filter(Boolean)
    .join(" ");
  const town = str("city") || str("town") || str("village") || str("district");
  const region = str("state") || str("county");

  const name =
    str("name") || streetLine || town || str("postcode") || "Dropped pin";

  const addressParts = [
    // Don't echo the headline back as its own subtitle.
    streetLine && streetLine !== name ? streetLine : "",
    town && town !== name ? town : "",
    region && region !== town ? region : "",
    str("postcode"),
  ].filter(Boolean);

  const id =
    str("osm_type") && props.osm_id !== undefined
      ? `${str("osm_type")}${props.osm_id}`
      : `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

  return {
    id,
    name: name.slice(0, MAX_NAME),
    address: addressParts.join(", ").slice(0, MAX_ADDRESS),
    latitude,
    longitude,
    ...(near
      ? { distanceMeters: haversineMeters(near, { latitude, longitude }) }
      : {}),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance. Good to a metre or so at the scales we show. */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/**
 * Distance as a glanceable label. Precision drops as the number grows: at
 * 40 km nobody is choosing between 41.3 and 41 — they're checking it isn't the
 * one in the next county.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
