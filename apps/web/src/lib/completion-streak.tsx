"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { completionDays, isStreakDay, todayLocalISO } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";

/**
 * Whether a completion is the one keeping the user's run of days alive.
 *
 * Mounted once for the whole app rather than per row: it is one fetch of the
 * recent completion history, and a hundred rows each asking the same question
 * would be a hundred round-trips to learn a single fact.
 *
 * The answer has to be available *synchronously* — the row decides whether to
 * spark inside the tap handler, on the frame of the tap, where an await would
 * cost exactly the frame the animation exists to use. So the history lives in a
 * ref and the read is a plain function call.
 */
interface CompletionStreak {
  /**
   * Ask, and record, in one call: returns true when this completion keeps a
   * streak alive, and marks today as done either way.
   *
   * One call rather than a read plus a note, because *any* completion starts
   * the day — including one that sparked for some other reason. Splitting them
   * would let a second completion a moment later claim the day again.
   *
   * Call only when completing. Reopening a task is a correction, and must not
   * mark a day the user hasn't actually worked.
   */
  claimStreakDay: () => boolean;
}

/**
 * Default for anywhere without a provider — Storybook, tests, the single-task
 * page. `false` rather than a guess: an unknown history should cost a burst,
 * never invent one.
 */
const CompletionStreakContext = createContext<CompletionStreak>({
  claimStreakDay: () => false,
});

/** How far back to look. Comfortably more than any run we'd celebrate. */
const HISTORY_LIMIT = 120;

export function CompletionStreakProvider({ children }: { children: ReactNode }) {
  // `null` means "not loaded yet", which is deliberately distinct from "no days
  // at all" — before the history lands, nothing can be claimed.
  const days = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const api = await getClientTasksApi();
        const { data, error } = await api.listCompleted({ limit: HISTORY_LIMIT });
        if (cancelled || error) return;
        days.current = new Set(completionDays(data.map((t) => t.completed_at)));
      } catch {
        // A streak is a garnish on an animation. If the history can't be read,
        // the rule simply never fires — nothing else about completing a task
        // depends on this.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const claimStreakDay = useCallback(() => {
    const have = days.current;
    if (!have) return false;
    const today = todayLocalISO();
    const keeper = isStreakDay([...have], today);
    have.add(today);
    return keeper;
  }, []);

  return (
    <CompletionStreakContext.Provider value={{ claimStreakDay }}>
      {children}
    </CompletionStreakContext.Provider>
  );
}

export function useCompletionStreak(): CompletionStreak {
  return useContext(CompletionStreakContext);
}
