/**
 * Tests for the type-ahead place search.
 *
 * Everything here is the part of location capture that has no device
 * dependency: the query we send, and the label we make out of what comes back.
 * Both fail quietly on a phone — a bias parameter that never got sent looks
 * like "the search is just bad", and a row that reads "Congress Avenue /
 * Congress Avenue" looks like the provider's fault.
 */
import { describe, it, expect, vi } from "vitest";
import {
  formatDistance,
  haversineMeters,
  PlaceSearchError,
  searchPlaces,
  toSuggestion,
} from "./place-search";

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function feature(
  properties: Record<string, string | number>,
  coordinates: [number, number] = [-0.12, 51.5]
) {
  return { geometry: { coordinates }, properties };
}

describe("searchPlaces", () => {
  it("sends the query, the cap and the position bias", async () => {
    const fetchImpl = fakeFetch({ features: [] });
    await searchPlaces("  target  ", {
      near: { latitude: 30.25, longitude: -97.75 },
      limit: 5,
      fetchImpl,
    });

    const url = new URL(vi.mocked(fetchImpl).mock.calls[0][0] as string);
    expect(url.searchParams.get("q")).toBe("target");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("lat")).toBe("30.25");
    expect(url.searchParams.get("lon")).toBe("-97.75");
  });

  it("omits the bias when we don't know where the user is", async () => {
    const fetchImpl = fakeFetch({ features: [] });
    await searchPlaces("target", { fetchImpl });

    const url = new URL(vi.mocked(fetchImpl).mock.calls[0][0] as string);
    expect(url.searchParams.has("lat")).toBe(false);
    expect(url.searchParams.has("lon")).toBe(false);
  });

  it("does not call out at all for an empty query", async () => {
    const fetchImpl = fakeFetch({ features: [] });
    expect(await searchPlaces("   ", { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("collapses the POI and the building it sits in into one row", async () => {
    const fetchImpl = fakeFetch({
      features: [
        feature({
          osm_type: "N",
          osm_id: 1,
          name: "Target",
          housenumber: "1300",
          street: "S Congress Ave",
          city: "Austin",
        }),
        feature({
          osm_type: "W",
          osm_id: 2,
          name: "Target",
          housenumber: "1300",
          street: "S Congress Ave",
          city: "Austin",
        }),
      ],
    });

    const results = await searchPlaces("target", { fetchImpl });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("N1");
  });

  it("reports a failed lookup rather than an empty result set", async () => {
    const fetchImpl = fakeFetch({}, { ok: false, status: 503 });
    await expect(searchPlaces("target", { fetchImpl })).rejects.toBeInstanceOf(
      PlaceSearchError
    );
  });

  it("lets an abort through untouched — that's the caller superseding itself", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn(async () => {
      throw abort;
    }) as unknown as typeof fetch;

    await expect(searchPlaces("target", { fetchImpl })).rejects.toBe(abort);
  });

  it("wraps a network failure as a search error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;

    await expect(searchPlaces("target", { fetchImpl })).rejects.toBeInstanceOf(
      PlaceSearchError
    );
  });
});

describe("toSuggestion", () => {
  it("reads GeoJSON's [lon, lat] the right way round", () => {
    const s = toSuggestion(feature({ name: "Home" }, [-97.75, 30.25]));
    expect(s?.latitude).toBe(30.25);
    expect(s?.longitude).toBe(-97.75);
  });

  it("leads with the POI name and never repeats it underneath", () => {
    const s = toSuggestion(
      feature({
        name: "Target",
        housenumber: "1300",
        street: "S Congress Ave",
        city: "Austin",
        state: "Texas",
      })
    );
    expect(s?.name).toBe("Target");
    expect(s?.address).toBe("1300 S Congress Ave, Austin, Texas");
  });

  it("leads a plain address with its street line, town underneath", () => {
    const s = toSuggestion(
      feature({ housenumber: "221", street: "Baker Street", city: "London" })
    );
    expect(s?.name).toBe("221 Baker Street");
    expect(s?.address).toBe("London");
  });

  it("falls back through town, then postcode, then a dropped pin", () => {
    expect(toSuggestion(feature({ city: "Austin" }))?.name).toBe("Austin");
    expect(toSuggestion(feature({ postcode: "78704" }))?.name).toBe("78704");
    expect(toSuggestion(feature({}))?.name).toBe("Dropped pin");
  });

  it("rejects a feature with no usable position", () => {
    expect(toSuggestion({ properties: { name: "Nowhere" } })).toBeNull();
    expect(
      toSuggestion({
        geometry: { coordinates: [200, 100] as [number, number] },
        properties: { name: "Off the globe" },
      })
    ).toBeNull();
  });

  it("attaches a distance only when we knew where the user was", () => {
    const props = { name: "Target" };
    expect(toSuggestion(feature(props))?.distanceMeters).toBeUndefined();
    expect(
      toSuggestion(feature(props, [-0.12, 51.51]), {
        latitude: 51.5,
        longitude: -0.12,
      })?.distanceMeters
    ).toBeGreaterThan(1000);
  });
});

describe("distance", () => {
  it("measures a known separation", () => {
    // London ↔ Paris, ~343 km.
    const meters = haversineMeters(
      { latitude: 51.5074, longitude: -0.1278 },
      { latitude: 48.8566, longitude: 2.3522 }
    );
    expect(meters).toBeGreaterThan(340_000);
    expect(meters).toBeLessThan(346_000);
  });

  it("loses precision as the number grows", () => {
    expect(formatDistance(87)).toBe("90 m");
    expect(formatDistance(940)).toBe("940 m");
    expect(formatDistance(1240)).toBe("1.2 km");
    expect(formatDistance(41_300)).toBe("41 km");
  });
});
