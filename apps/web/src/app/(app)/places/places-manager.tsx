"use client";

/**
 * Saved places manager — the web half of `apps/mobile/app/locations.tsx`.
 *
 * Attaching a reminder happens in the task editor; this page is the other
 * half: renaming a place, widening its radius when the reminder keeps missing,
 * and deleting places you no longer visit. It also surfaces the two things
 * that otherwise fail invisibly — the platform cap on monitored regions, and a
 * place with no open tasks, which is deliberately never registered at all.
 *
 * **It lists the tasks, where mobile lists a count.** A laptop has the room,
 * and "which tasks are waiting for me at the supermarket?" is a question the
 * phone can only answer by opening them one at a time. This is the only view
 * in either app organised by place rather than by day, so listing them is what
 * the page is for.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  GEOFENCE_COOLDOWN_MINUTES,
  GEOFENCE_DWELL_SECONDS,
  GEOFENCE_MAX_REGIONS,
  LOCATION_RADIUS_PRESETS,
  TRIGGER_LABELS,
  type Location,
  type Task,
  type TaskLocationLinkRow,
  type TriggerType,
} from "@do-done/shared";
import { getClientLocationsApi } from "@/lib/supabase/locations-client";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { taskPath } from "@/lib/task-link";

const CLOSED_STATUSES = new Set(["done", "cancelled", "archived"]);

/**
 * The cap this page warns about is iOS's, on both counts.
 *
 * Nothing here knows which phone the reminders will fire on, and the two
 * platforms differ by a factor of five (`GEOFENCE_MAX_REGIONS`). Warning at
 * Android's 100 would let an iPhone silently stop watching eighty places;
 * warning at 20 is at worst an early caution for an Android user, which the
 * sentence says out loud.
 */
const CAP = GEOFENCE_MAX_REGIONS.ios;

interface PlaceRow {
  location: Location;
  /** Open tasks reminding here, and the direction each one is set for. */
  waiting: Array<{ task: Task; triggers: TriggerType[] }>;
  /** Over the region cap, so a phone would not be watching it. */
  paused: boolean;
}

export function PlacesManager() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [links, setLinks] = useState<TaskLocationLinkRow[]>([]);
  const [tasks, setTasks] = useState<Map<string, Task>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // A write asks for a refetch by bumping this rather than by calling a
  // loader, so the fetch stays inside the effect that owns it — which is what
  // gives it a cancellation flag. A card that renames a place and then
  // navigates away would otherwise land its `setState` on a gone tree.
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [locationsApi, tasksApi] = await Promise.all([
        getClientLocationsApi(),
        getClientTasksApi(),
      ]);
      const [saved, allLinks, allTasks] = await Promise.all([
        // Every saved place, not just the ones currently armed — a place whose
        // tasks are all done still needs to be renameable and deletable.
        locationsApi.list(),
        locationsApi.listTaskLinks(),
        tasksApi.list(),
      ]);
      if (cancelled) return;
      if (saved.error || allLinks.error) {
        setError("Couldn't load your saved places.");
        setLoading(false);
        return;
      }
      setLocations(saved.data);
      setLinks(allLinks.data);
      setTasks(new Map(allTasks.data.map((t) => [t.id, t])));
      setError(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  /**
   * Same ordering `registerUserGeofences()` uses, so "Paused" here means
   * exactly the places a phone would trim.
   *
   * The armed half is built from the links, which reach one-off places too — a
   * place attached inline to a task holds a region like any other, and a cap
   * warning counting regions this page didn't list would be unanswerable. The
   * idle half comes from the saved list, since a one-off place with no
   * reminders left has already been swept away by the database.
   */
  const rows = useMemo<PlaceRow[]>(() => {
    const byLocation = new Map<string, Map<string, TriggerType[]>>();
    for (const link of links) {
      const task = tasks.get(link.task_id);
      if (!task || CLOSED_STATUSES.has(task.status)) continue;
      const forPlace =
        byLocation.get(link.location.id) ?? new Map<string, TriggerType[]>();
      forPlace.set(link.task_id, [
        ...(forPlace.get(link.task_id) ?? []),
        link.trigger_type,
      ]);
      byLocation.set(link.location.id, forPlace);
    }

    // A one-off place is only ever reachable through a link, so the union of
    // the two sources is what this page can see at all.
    const known = new Map(locations.map((l) => [l.id, l]));
    for (const link of links) {
      if (!known.has(link.location.id)) known.set(link.location.id, link.location);
    }

    const armed = [...byLocation.entries()]
      .map(([locationId, forPlace]) => ({
        location: known.get(locationId)!,
        waiting: [...forPlace.entries()]
          .map(([taskId, triggers]) => ({ task: tasks.get(taskId)!, triggers }))
          .sort((a, b) => a.task.title.localeCompare(b.task.title)),
      }))
      .filter((row) => !!row.location)
      .sort(
        (a, b) =>
          b.waiting.length - a.waiting.length ||
          a.location.name.localeCompare(b.location.name)
      )
      .map((row, index) => ({ ...row, paused: index >= CAP }));

    const armedIds = new Set(armed.map((r) => r.location.id));
    const idle = locations
      .filter((l) => !armedIds.has(l.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((location) => ({ location, waiting: [], paused: false }));

    return [...armed, ...idle];
  }, [locations, links, tasks]);

  const armedCount = rows.filter((r) => r.waiting.length > 0).length;
  const overCap = armedCount > CAP;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Places
      </h1>

      {/* Composed as strings rather than interleaved into the markup: JSX
          strips the leading whitespace off a text node that spans lines, so
          `{GEOFENCE_DWELL_SECONDS} seconds` across a line break renders as
          "90seconds". */}
      <p className="mb-5 max-w-prose text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        {`A reminder fires on your phone once you’ve been inside a place for ${GEOFENCE_DWELL_SECONDS} seconds, so driving past doesn’t trigger it. After one fires it stays quiet for ${GEOFENCE_COOLDOWN_MINUTES} minutes. Your browser can’t tell where you are in the background, so nothing arrives here.`}
      </p>

      {overCap ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {`A phone watches at most ${CAP} places at once — that’s iPhone’s limit, and Android allows more. The ${armedCount - CAP} with the fewest open tasks are paused.`}
        </p>
      ) : null}

      {loading ? (
        <p className="text-[13px] text-neutral-400">Loading…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>
      ) : rows.length === 0 ? (
        <p className="max-w-prose text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          No places yet. Open a task, add one under{" "}
          <span className="font-semibold text-neutral-700 dark:text-neutral-200">
            Places
          </span>
          , and it will show up here.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <PlaceCard
              key={row.location.id}
              row={row}
              editing={editingId === row.location.id}
              onToggleEdit={() =>
                setEditingId((id) =>
                  id === row.location.id ? null : row.location.id
                )
              }
              onChanged={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceCard({
  row,
  editing,
  onToggleEdit,
  onChanged,
}: {
  row: PlaceRow;
  editing: boolean;
  onToggleEdit: () => void;
  onChanged: () => void;
}) {
  const { location, waiting, paused } = row;
  const [name, setName] = useState(location.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A rename by someone else, or a reload, should win over a stale draft.
  useEffect(() => setName(location.name), [location.name]);

  const write = async (
    work: () => Promise<{ error: Error | null }>,
    failure: string
  ) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await work();
      if (err) setError(failure);
      onChanged();
    } catch {
      setError(failure);
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === location.name) {
      setName(location.name);
      return;
    }
    await write(async () => {
      const api = await getClientLocationsApi();
      return api.update(location.id, { name: trimmed });
    }, "That rename didn't save.");
  };

  const setRadius = (meters: number) => {
    if (meters === location.radius_meters) return;
    void write(async () => {
      const api = await getClientLocationsApi();
      return api.update(location.id, { radius_meters: meters });
    }, "That change didn't save.");
  };

  const keepPlace = () =>
    void write(async () => {
      const api = await getClientLocationsApi();
      return api.save(location.id);
    }, "That place wasn't added to your places.");

  const remove = () =>
    void write(async () => {
      const api = await getClientLocationsApi();
      return api.remove(location.id);
    }, "That place is still there.");

  return (
    <div
      className={`rounded-xl border bg-white p-4 dark:bg-neutral-900 ${
        paused
          ? "border-dashed border-neutral-300 dark:border-neutral-700"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              value={name}
              autoFocus
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setName(location.name);
                  onToggleEdit();
                }
              }}
              className="w-full rounded-md border border-indigo-300 bg-white px-2 py-1 text-[14px] font-semibold text-neutral-900 outline-none dark:border-indigo-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          ) : (
            <h2 className="truncate text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
              {location.name}
            </h2>
          )}
          {location.address ? (
            <p className="truncate text-[12px] text-neutral-500">
              {location.address}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onToggleEdit}
          className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {editing ? "Done" : "Rename"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Delete
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-neutral-500">
          {waiting.length === 0
            ? "Not watching — no open tasks"
            : `${waiting.length} open ${waiting.length === 1 ? "task" : "tasks"}`}
        </span>
        {paused ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Paused
          </span>
        ) : null}
        {saving ? <span className="text-neutral-400">Saving…</span> : null}
      </div>

      {waiting.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {waiting.map(({ task, triggers }) => (
            <li key={task.id}>
              <Link
                href={taskPath(task.id)}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              >
                <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">
                  {task.title}
                </span>
                <span className="shrink-0 text-[11px] text-neutral-400">
                  {triggers.map((t) => TRIGGER_LABELS[t]).join(" and ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          How close
        </span>
        {LOCATION_RADIUS_PRESETS.map((preset) => {
          const on = location.radius_meters === preset.meters;
          return (
            <button
              key={preset.meters}
              type="button"
              title={preset.hint}
              aria-pressed={on}
              disabled={saving}
              onClick={() => setRadius(preset.meters)}
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
                on
                  ? "bg-indigo-500 text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              {preset.label}
              <span className="ml-1 opacity-60">
                {preset.meters >= 1000
                  ? `${preset.meters / 1000} km`
                  : `${preset.meters} m`}
              </span>
            </button>
          );
        })}
      </div>

      {/* A one-off place is here only because it holds a region; it isn't in
          the saved list and disappears with its last reminder. Saying so is
          what stops "why can't I find this place again?". */}
      {location.is_saved ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <span className="text-[12px] text-neutral-500">
            One-off — goes away with its last reminder.
          </span>
          <button
            type="button"
            onClick={keepPlace}
            disabled={saving}
            className="rounded-md border border-neutral-200 px-2 py-1 text-[11.5px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Keep this place
          </button>
        </div>
      )}

      {error ? (
        <p className="mt-2 text-[11.5px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {confirmingDelete ? (
        <ConfirmDelete
          name={location.name}
          waitingCount={waiting.length}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false);
            remove();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Deleting a place is the one thing here with no undo — `task_locations`
 * cascades — so it says exactly what goes and what stays.
 */
function ConfirmDelete({
  name,
  waitingCount,
  onCancel,
  onConfirm,
}: {
  name: string;
  waitingCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const one = waitingCount === 1;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-900/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-place"
        onClick={(e) => e.stopPropagation()}
        className="w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(17,24,39,0.18)] dark:bg-neutral-950 dark:ring-1 dark:ring-white/10"
      >
        <div className="px-6 pb-5 pt-6">
          <h2
            id="confirm-delete-place"
            className="text-[17px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50"
          >
            Delete “{name}”?
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {waitingCount > 0
              ? `${waitingCount} open ${one ? "task is" : "tasks are"} reminding you here. Deleting the place removes ${one ? "that reminder" : "those reminders"} — the ${one ? "task" : "tasks"} stay.`
              : "This place has no reminders attached."}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3.5 dark:border-neutral-900 dark:bg-neutral-900/50">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-red-700"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
