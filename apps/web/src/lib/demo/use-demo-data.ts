"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getDemoState,
  hydrateDemoStore,
  subscribeDemoStore,
  type DemoState,
} from "./store";

export interface DemoData extends DemoState {
  /**
   * Shopping-list items, kept out of `tasks` and offered separately.
   *
   * Two fields rather than one flag to filter by, because every existing
   * screen reads `tasks` and every one of them means the task universe — so
   * the split is what makes the isolation the default rather than something
   * each caller has to remember.
   */
  items: import("@do-done/shared").Task[];
  /**
   * False until the saved sandbox has been adopted on the client.
   *
   * The seed is dated from the *reader's* calendar day, and the server's day
   * is UTC — so anything date-shaped rendered during SSR is a hydration
   * mismatch waiting to happen, on top of showing a stranger's pristine seed
   * to someone who already moved things around. Screens hold a placeholder
   * for the one tick this takes rather than paint an answer they'd have to
   * take back.
   */
  ready: boolean;
}

/**
 * The sandbox's data, re-rendering the caller on every write to it.
 *
 * **Deleted tasks are filtered out here**, and this is the only place they can
 * be: the demo screens read the store through this hook rather than calling
 * `DemoTasksApi.list()`, so the filter the API's getter applies never reaches
 * them. Without it a deleted task simply stayed on screen — the soft delete
 * hides a row by marking it, and a reader that looks straight at the array
 * sees the mark and nothing else.
 *
 * The real app has no equivalent gap, because its lists are server components
 * that go through `TasksApi` like everything else.
 *
 * **Shopping-list items are filtered out for exactly the same reason**, and
 * `items` carries them separately for the surfaces that want them. A demo
 * screen reading `tasks` gets the task universe, which is what every one of
 * them means.
 */
export function useDemoData(): DemoData {
  const state = useSyncExternalStore(
    subscribeDemoStore,
    getDemoState,
    getDemoState
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    hydrateDemoStore();
    setReady(true);
  }, []);
  const live = useMemo(
    () => state.tasks.filter((t) => !t.deleted_at),
    [state.tasks]
  );
  const tasks = useMemo(
    () => live.filter((t) => t.is_list_item !== true),
    [live]
  );
  const items = useMemo(
    () => live.filter((t) => t.is_list_item === true),
    [live]
  );
  return { ...state, tasks, items, ready };
}
