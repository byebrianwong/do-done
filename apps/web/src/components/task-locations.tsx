"use client";

/**
 * "Remind me at a place", in the web task editor.
 *
 * The web twin of `apps/mobile/components/LocationReminderSheet.tsx`, and
 * deliberately the same interaction: a search field over complete, tappable
 * places, where **the first click attaches the reminder** and everything else —
 * which direction, how close, whether to keep the place — is an adjustment made
 * afterwards on a row that is already doing its job. Asking for a name, then an
 * address, then a radius before anything is attached is the flow mobile threw
 * out; repeating it here would make the two apps disagree about what setting a
 * place reminder involves.
 *
 * What web genuinely can't do is the other half. A geofence is the phone's job:
 * there is no browser API that wakes an app when you walk into a shop, and the
 * notification is posted locally by `apps/mobile/lib/geofence-task.ts`. So this
 * section reads and writes the same `task_locations` rows and says plainly
 * where the reminder will arrive, rather than implying the laptop will buzz.
 *
 * Everything it writes goes through `LocationsApi`, the same door mobile uses,
 * so a place attached here is geofenced on the phone at its next sync.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LOCATION_RADIUS_METERS,
  DEFAULT_TRIGGER,
  LOCATION_RADIUS_PRESETS,
  TRIGGER_LABELS,
  formatDistance,
  haversineMeters,
  searchPlaces,
  type Coordinates,
  type Location,
  type PlaceSuggestion,
  type TaskLocationLink,
  type TriggerType,
} from "@do-done/shared";
import type { LocationsApi } from "@do-done/api-client";
import { announceLocationsChanged } from "@/lib/task-location-events";
import { MapPreview } from "./map-preview";

/**
 * Short enough to feel live, long enough that a typed word is one request
 * rather than six. The provider is keyless and asks callers to be fair.
 */
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;

/** A place on this task, with every direction it is set for. */
interface AttachedPlace {
  location: Location;
  triggers: Set<TriggerType>;
}

const TRIGGER_ORDER: TriggerType[] = ["enter", "exit"];

/**
 * The radius as a distance, never as its preset label.
 *
 * `LOCATION_RADIUS_PRESETS` names 200 m "Arriving" — which is the right word
 * on a row of choices headed "How close", and exactly the wrong one in a line
 * that also names the *direction*: "Arriving and leaving · Arriving" is what
 * that reads as. The buttons keep their names; the summary states the number.
 */
function radiusDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

/** "Arriving", "Leaving", or "Arriving and leaving" — sentence case, once. */
function directionsLabel(triggers: Set<TriggerType>): string {
  const words = TRIGGER_ORDER.filter((t) => triggers.has(t)).map(
    (t) => TRIGGER_LABELS[t]
  );
  if (words.length === 0) return "";
  const [first, ...rest] = words;
  return [first, ...rest.map((w) => w.toLowerCase())].join(" and ");
}

/** Group a task's links into one row per place. */
function groupByPlace(links: TaskLocationLink[]): AttachedPlace[] {
  const byId = new Map<string, AttachedPlace>();
  for (const link of links) {
    const existing = byId.get(link.location.id);
    if (existing) existing.triggers.add(link.trigger_type);
    else
      byId.set(link.location.id, {
        location: link.location,
        triggers: new Set([link.trigger_type]),
      });
  }
  return [...byId.values()];
}

/**
 * Where the browser already knows the user is — and *only* if it already
 * knows.
 *
 * `getCurrentPosition` prompts, and a permission dialog thrown up by opening a
 * task editor is the fastest way to have location denied for the whole origin.
 * The Permissions API answers "has this already been granted?" without asking,
 * which is the same bargain mobile strikes with `getLastKnownPosition()`.
 * Firefox has no geolocation entry in that API, so it simply never biases —
 * degrading to an unbiased search, which is what every search was before.
 */
async function positionIfAlreadyAllowed(): Promise<Coordinates | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  try {
    const status = await navigator.permissions?.query({
      name: "geolocation" as PermissionName,
    });
    if (status?.state !== "granted") return null;
  } catch {
    return null;
  }
  return readPosition().catch(() => null);
}

function readPosition(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      reject,
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}

export function LocationSection({
  taskId,
  api,
}: {
  taskId: string;
  api: LocationsApi;
}) {
  const [links, setLinks] = useState<TaskLocationLink[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<Location[]>([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [position, setPosition] = useState<Coordinates | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const places = useMemo(() => groupByPlace(links), [links]);
  const attachedIds = useMemo(
    () => new Set(places.map((p) => p.location.id)),
    [places]
  );

  /** Re-read this task's links after any write, so the rows are the truth. */
  const reload = useCallback(async () => {
    const { data, error: err } = await api.getTaskLocations(taskId);
    if (err) {
      setError("Couldn't load this task's places.");
      return;
    }
    setLinks(data);
    announceLocationsChanged();
  }, [api, taskId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: taskLinks }, { data: saved }] = await Promise.all([
        api.getTaskLocations(taskId),
        api.list(),
      ]);
      if (cancelled) return;
      setLinks(taskLinks);
      setSavedPlaces(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, taskId]);

  useEffect(() => {
    let cancelled = false;
    void positionIfAlreadyAllowed().then((p) => {
      if (!cancelled) setPosition(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced type-ahead. The abort controller is what stops a slow early
  // request landing on top of a fast later one and showing yesterday's word.
  useEffect(() => {
    const q = query.trim();
    if (!adding || q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchPlaces(q, { near: position, signal: controller.signal })
        .then((found) => {
          setResults(found);
          setSearchFailed(false);
        })
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === "AbortError") return;
          setResults([]);
          setSearchFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, position, adding]);

  /** Saved places worth offering: not already on this task, matching what's typed. */
  const savedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return savedPlaces
      .filter((place) => !attachedIds.has(place.id))
      .filter(
        (place) =>
          !q ||
          place.name.toLowerCase().includes(q) ||
          (place.address ?? "").toLowerCase().includes(q)
      );
  }, [savedPlaces, attachedIds, query]);

  /**
   * Run a write, keep one thing busy at a time, and reload from the server
   * afterwards. Every mutation here is a link or a small column change, so
   * re-reading costs one query and removes any chance of the rows disagreeing
   * with the database about a place two directions were just toggled on.
   */
  const run = useCallback(
    async (key: string, work: () => Promise<Error | null>, failure: string) => {
      if (busyKey) return;
      setBusyKey(key);
      setError(null);
      try {
        const err = await work();
        if (err) setError(failure);
        await reload();
      } catch {
        setError(failure);
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, reload]
  );

  /** Clear the search back to the resting state once something is attached. */
  const settleAfterAttach = (locationId: string) => {
    setQuery("");
    setResults([]);
    setAdding(false);
    setExpandedId(locationId);
  };

  const attachSaved = (place: Location) =>
    run(
      `saved:${place.id}`,
      async () => {
        const { error: err } = await api.linkTask(
          taskId,
          place.id,
          DEFAULT_TRIGGER
        );
        if (!err) settleAfterAttach(place.id);
        return err;
      },
      "That reminder didn't stick. Try again."
    );

  /**
   * A place picked from search is attached as a *one-off*: geofenced exactly
   * like a saved one, hidden from the picker, and swept away by the database
   * when its last reminder goes. "Save place" promotes it if it turns out to
   * be somewhere you go.
   */
  const attachSuggestion = (place: PlaceSuggestion) =>
    run(
      `result:${place.id}`,
      async () => {
        const { data: created, error: err } = await api.create({
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          radius_meters: DEFAULT_LOCATION_RADIUS_METERS,
          is_saved: false,
          ...(place.address ? { address: place.address } : {}),
        });
        if (err || !created) return err ?? new Error("no row");
        const { error: linkErr } = await api.linkTask(
          taskId,
          created.id,
          DEFAULT_TRIGGER
        );
        if (!linkErr) settleAfterAttach(created.id);
        return linkErr;
      },
      "That reminder didn't stick. Try again."
    );

  /** The one control here that deliberately prompts — the user asked for it. */
  const attachCurrentPosition = async () => {
    if (locating || busyKey) return;
    setLocating(true);
    setError(null);
    try {
      const here = await readPosition();
      setPosition(here);
      const { data: created, error: err } = await api.create({
        name: "Here",
        latitude: here.latitude,
        longitude: here.longitude,
        radius_meters: DEFAULT_LOCATION_RADIUS_METERS,
        is_saved: false,
      });
      if (err || !created) {
        setError("That place couldn't be saved. Try again.");
        return;
      }
      const { error: linkErr } = await api.linkTask(
        taskId,
        created.id,
        DEFAULT_TRIGGER
      );
      if (linkErr) setError("That reminder didn't stick. Try again.");
      else settleAfterAttach(created.id);
      await reload();
    } catch {
      setError("Couldn't read your location. Check the site's permissions.");
    } finally {
      setLocating(false);
    }
  };

  const detach = (place: AttachedPlace) =>
    run(
      `${place.location.id}:detach`,
      async () => {
        for (const trigger of place.triggers) {
          const { error: err } = await api.unlinkTask(
            taskId,
            place.location.id,
            trigger
          );
          if (err) return err;
        }
        setExpandedId((id) => (id === place.location.id ? null : id));
        return null;
      },
      "That reminder is still there."
    );

  const toggleTrigger = (place: AttachedPlace, trigger: TriggerType) => {
    const on = place.triggers.has(trigger);
    // Switching off the only direction left removes the reminder entirely —
    // and takes a one-off place with it, since nothing else points at it.
    if (on && place.triggers.size === 1) return detach(place);

    return run(
      `${place.location.id}:${trigger}`,
      async () => {
        const { error: err } = on
          ? await api.unlinkTask(taskId, place.location.id, trigger)
          : await api.linkTask(taskId, place.location.id, trigger);
        return err;
      },
      "That reminder didn't stick. Try again."
    );
  };

  const changeRadius = (place: AttachedPlace, meters: number) => {
    if (meters === place.location.radius_meters) return;
    return run(
      `${place.location.id}:radius`,
      async () => {
        const { error: err } = await api.update(place.location.id, {
          radius_meters: meters,
        });
        return err;
      },
      "That change didn't save."
    );
  };

  const keepPlace = (place: AttachedPlace) =>
    run(
      `${place.location.id}:save`,
      async () => {
        const { error: err } = await api.save(place.location.id);
        if (!err) {
          const { data } = await api.list();
          setSavedPlaces(data);
        }
        return err;
      },
      "That place wasn't added to your places."
    );

  const empty = places.length === 0;

  return (
    <div>
      {empty && !adding ? null : (
        <div className="mb-2 flex items-baseline gap-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
            Places
          </span>
          {places.length > 0 ? (
            <span className="text-[11px] font-medium text-neutral-500">
              {places.length}
            </span>
          ) : null}
        </div>
      )}

      {places.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-neutral-100 bg-neutral-50/60 p-2 dark:border-neutral-900 dark:bg-neutral-900/40">
          {places.map((place) => (
            <AttachedPlaceCard
              key={place.location.id}
              place={place}
              expanded={expandedId === place.location.id}
              busyKey={busyKey}
              you={position}
              onToggleExpanded={() =>
                setExpandedId((id) =>
                  id === place.location.id ? null : place.location.id
                )
              }
              onToggleTrigger={(t) => void toggleTrigger(place, t)}
              onChangeRadius={(m) => void changeRadius(place, m)}
              onKeepPlace={() => void keepPlace(place)}
              onDetach={() => void detach(place)}
            />
          ))}
        </div>
      ) : null}

      {adding ? (
        <AddPlacePanel
          query={query}
          onQueryChange={setQuery}
          inputRef={searchInput}
          searching={searching}
          searchFailed={searchFailed}
          results={results}
          savedMatches={savedMatches}
          position={position}
          busyKey={busyKey}
          locating={locating}
          onPickSaved={(p) => void attachSaved(p)}
          onPickSuggestion={(p) => void attachSuggestion(p)}
          onUseCurrentPosition={() => void attachCurrentPosition()}
          onCancel={() => {
            setAdding(false);
            setQuery("");
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            // The panel mounts this frame; focus it on the next one.
            requestAnimationFrame(() => searchInput.current?.focus());
          }}
          className={`flex items-center gap-2 rounded-md text-left text-[12px] font-medium text-neutral-500 transition-colors hover:text-indigo-600 dark:hover:text-indigo-400 ${
            empty
              ? "border border-neutral-200 px-2.5 py-1.5 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
              : "mt-1 w-full px-2 py-1.5 hover:bg-white dark:hover:bg-neutral-900"
          }`}
        >
          <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
          {empty ? "Remind me at a place" : "Add another place"}
        </button>
      )}

      {error ? (
        <p className="mt-2 text-[11.5px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {places.length > 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
          Place reminders arrive on your phone, which is the only thing that can
          tell when you get there. Editing them here changes what it watches
          for.
        </p>
      ) : null}
    </div>
  );
}

function AttachedPlaceCard({
  place,
  expanded,
  busyKey,
  you,
  onToggleExpanded,
  onToggleTrigger,
  onChangeRadius,
  onKeepPlace,
  onDetach,
}: {
  place: AttachedPlace;
  expanded: boolean;
  busyKey: string | null;
  you: Coordinates | null;
  onToggleExpanded: () => void;
  onToggleTrigger: (trigger: TriggerType) => void;
  onChangeRadius: (meters: number) => void;
  onKeepPlace: () => void;
  onDetach: () => void;
}) {
  const { location } = place;
  const directions = directionsLabel(place.triggers);
  const center = useMemo(
    () => ({ latitude: location.latitude, longitude: location.longitude }),
    [location.latitude, location.longitude]
  );

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-neutral-800 dark:text-neutral-100">
              {location.name}
            </span>
            <span className="block truncate text-[11px] text-neutral-500">
              {directions} · within {radiusDistance(location.radius_meters)}
              {location.address ? ` · ${location.address}` : ""}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onDetach}
          disabled={busyKey !== null}
          aria-label={`Remove the reminder at ${location.name}`}
          className="shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <CrossIcon className="h-3 w-3" />
        </button>
      </div>

      {expanded ? (
        <div className="space-y-2.5 border-t border-neutral-100 px-2.5 py-2.5 dark:border-neutral-900">
          <MapPreview
            center={center}
            radiusMeters={location.radius_meters}
            you={you}
            height={190}
            label={location.address ?? location.name}
          />

          <Field label="Remind me">
            {TRIGGER_ORDER.map((trigger) => {
              const on = place.triggers.has(trigger);
              return (
                <Chip
                  key={trigger}
                  on={on}
                  disabled={busyKey !== null}
                  onClick={() => onToggleTrigger(trigger)}
                >
                  {TRIGGER_LABELS[trigger]}
                </Chip>
              );
            })}
          </Field>

          {/* Each radius chip carries its distance as well as its name. One of
              the presets is called "Arriving", which is also one of the two
              directions in the row directly above — so on its own the selected
              chip reads as a second, contradictory answer to "remind me
              when?". The number is what tells the four of them apart. */}
          <Field label="How close">
            {LOCATION_RADIUS_PRESETS.map((preset) => (
              <Chip
                key={preset.meters}
                on={location.radius_meters === preset.meters}
                disabled={busyKey !== null}
                title={preset.hint}
                onClick={() => onChangeRadius(preset.meters)}
              >
                {preset.label}
                <span className="ml-1 opacity-60">
                  {radiusDistance(preset.meters)}
                </span>
              </Chip>
            ))}
          </Field>

          {location.is_saved ? null : (
            <button
              type="button"
              onClick={onKeepPlace}
              disabled={busyKey !== null}
              className="rounded-md border border-neutral-200 px-2 py-1 text-[11.5px] font-medium text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              Save place
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AddPlacePanel({
  query,
  onQueryChange,
  inputRef,
  searching,
  searchFailed,
  results,
  savedMatches,
  position,
  busyKey,
  locating,
  onPickSaved,
  onPickSuggestion,
  onUseCurrentPosition,
  onCancel,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  searching: boolean;
  searchFailed: boolean;
  results: PlaceSuggestion[];
  savedMatches: Location[];
  position: Coordinates | null;
  busyKey: string | null;
  locating: boolean;
  onPickSaved: (place: Location) => void;
  onPickSuggestion: (place: PlaceSuggestion) => void;
  onUseCurrentPosition: () => void;
  onCancel: () => void;
}) {
  const short = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH;
  const nothing =
    !searching &&
    !searchFailed &&
    !short &&
    query.trim().length >= MIN_QUERY_LENGTH &&
    results.length === 0 &&
    savedMatches.length === 0;

  return (
    <div className="mt-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            // Contained here rather than escaping to the modal, which would
            // close the whole editor over a search someone was mid-word in.
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
          placeholder="Search for a place…"
          aria-label="Search for a place"
          className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[12.5px] text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
        />
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-md px-2 py-1 text-[11.5px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          Cancel
        </button>
      </div>

      <div className="mt-1.5 max-h-64 dd-scroll overflow-y-auto">
        {savedMatches.length > 0 ? (
          <GroupLabel>Saved places</GroupLabel>
        ) : null}
        {savedMatches.map((place) => (
          <PickRow
            key={place.id}
            name={place.name}
            detail={place.address ?? ""}
            distance={
              position
                ? formatDistance(
                    haversineMeters(position, {
                      latitude: place.latitude,
                      longitude: place.longitude,
                    })
                  )
                : ""
            }
            disabled={busyKey !== null}
            busy={busyKey === `saved:${place.id}`}
            onClick={() => onPickSaved(place)}
          />
        ))}

        {results.length > 0 ? <GroupLabel>Search results</GroupLabel> : null}
        {results.map((place) => (
          <PickRow
            key={place.id}
            name={place.name}
            detail={place.address}
            distance={
              place.distanceMeters === undefined
                ? ""
                : formatDistance(place.distanceMeters)
            }
            disabled={busyKey !== null}
            busy={busyKey === `result:${place.id}`}
            onClick={() => onPickSuggestion(place)}
          />
        ))}

        {searching ? <Hint>Searching…</Hint> : null}
        {short ? <Hint>Keep typing — {MIN_QUERY_LENGTH} letters or more.</Hint> : null}
        {searchFailed ? (
          <Hint>Place search is unreachable right now.</Hint>
        ) : null}
        {nothing ? <Hint>Nothing matched that.</Hint> : null}
      </div>

      <button
        type="button"
        onClick={onUseCurrentPosition}
        disabled={locating || busyKey !== null}
        className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-indigo-600 disabled:opacity-50 dark:hover:bg-neutral-900 dark:hover:text-indigo-400"
      >
        <CrosshairIcon className="h-3.5 w-3.5 shrink-0" />
        {locating ? "Finding you…" : "Use where I am now"}
      </button>
    </div>
  );
}

function PickRow({
  name,
  detail,
  distance,
  disabled,
  busy,
  onClick,
}: {
  name: string;
  detail: string;
  distance: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:hover:bg-neutral-900"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-neutral-800 dark:text-neutral-100">
          {name}
        </span>
        {detail ? (
          <span className="block truncate text-[11px] text-neutral-500">
            {detail}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">
        {busy ? "Adding…" : distance}
      </span>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  on,
  disabled,
  title,
  onClick,
  children,
}: {
  on: boolean;
  disabled: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={on}
      className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
        on
          ? "bg-indigo-500 text-white"
          : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1.5 text-[11.5px] text-neutral-400">{children}</p>;
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CrosshairIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function CrossIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
