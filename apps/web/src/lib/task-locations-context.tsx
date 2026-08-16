"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { groupLinksByTask, type TaskLocationLink } from "@do-done/shared";
import { getClientLocationsApi } from "@/lib/supabase/locations-client";
import { TASK_LOCATIONS_CHANGED_EVENT } from "@/lib/task-location-events";

/**
 * Which tasks have a place reminder, for the whole app.
 *
 * A task set up on the phone — "buy milk when I get to Tesco" — has no date,
 * so on web it looked exactly like a task nobody had got round to planning.
 * That was the complaint: web had no awareness of locations at all, and an
 * organised task read as a neglected one.
 *
 * One query for the account, not one per row. `task_locations` holds a row
 * only because someone attached a reminder, so it is empty for most accounts
 * and small for the rest — whereas asking per row is a round-trip each to
 * learn that almost every one of them has nothing.
 *
 * State rather than a ref, unlike `CompletionStreakProvider`: this decides
 * what a row *renders*, so the chips have to appear when the links land. The
 * streak is read inside a tap handler and must not cost that frame, which is
 * why it is the other way round.
 */
const TaskLocationsContext = createContext<Map<string, TaskLocationLink[]>>(
  new Map()
);

/**
 * The links for one task, or an empty array.
 *
 * Empty is also what every surface with no provider gets — Storybook, the unit
 * tests, the drag overlay. A missing chip is the state the row was in before
 * this existed; inventing one would be worse.
 */
export function useTaskLocationLinks(taskId: string): TaskLocationLink[] {
  return useContext(TaskLocationsContext).get(taskId) ?? [];
}

export function TaskLocationsProvider({ children }: { children: ReactNode }) {
  const [byTask, setByTask] = useState<Map<string, TaskLocationLink[]>>(
    () => new Map()
  );
  // A refetch is asked for by bumping this rather than by calling a loader,
  // so the fetch stays inside the effect that owns it — which is what gives it
  // a cancellation flag. A `load()` invoked from an event handler has no
  // unmount to hang one off, and would still be in flight when the user signs
  // out or the tree goes away.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const api = await getClientLocationsApi();
      const { data, error } = await api.listTaskLinks();
      if (cancelled) return;
      // A failed read leaves the chips off, which is the same as having none.
      // Nothing here is worth an error state on top of every list in the app.
      if (!error) setByTask(groupLinksByTask(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  // The editor writes these links directly and is a layer over whatever page
  // is underneath, with no prop path to here — so it announces, and this
  // re-reads. See `lib/task-location-events.ts`.
  useEffect(() => {
    const onChanged = () => setReloads((n) => n + 1);
    window.addEventListener(TASK_LOCATIONS_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(TASK_LOCATIONS_CHANGED_EVENT, onChanged);
  }, []);

  return (
    <TaskLocationsContext.Provider value={byTask}>
      {children}
    </TaskLocationsContext.Provider>
  );
}
