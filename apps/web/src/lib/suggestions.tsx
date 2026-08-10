"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  buildSuggestionIndex,
  emptySuggestionIndex,
  type SuggestionIndex,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";

/**
 * The history behind the quick-add chips' guesses, counted once for the app.
 *
 * Mounted beside `CompletionStreakProvider` and for the same reason: it is one
 * fetch answering a question every capture surface asks, and four quick-add
 * surfaces each fetching their own copy would be four sweeps of the task list
 * to learn one thing.
 *
 * It differs from that provider in holding the index in *state* rather than a
 * ref. A streak is read inside a tap handler where a re-render would cost the
 * frame the animation needs; a suggestion is read while the user types, and the
 * chips have to fill in when the history lands — a ref would leave them empty
 * until the next keystroke happened to re-render them.
 *
 * Until it loads the index is empty, which `suggestFacets` reads as too little
 * history to speak from. Nothing suggests anything, which is exactly the right
 * behaviour for "we don't know yet".
 */
const SuggestionContext = createContext<SuggestionIndex>(emptySuggestionIndex());

export function SuggestionProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState<SuggestionIndex>(emptySuggestionIndex);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const api = await getClientTasksApi();
        const { data, error } = await api.suggestionHistory();
        if (cancelled || error) return;
        setIndex(buildSuggestionIndex(data));
      } catch {
        // A suggestion is an offer the user can ignore, so a history that
        // can't be read costs exactly one: the chips stay empty and quick-add
        // behaves as it did before this existed. Nothing else reads this.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SuggestionContext.Provider value={index}>
      {children}
    </SuggestionContext.Provider>
  );
}

/**
 * The index to score a title against. Without a provider (Storybook, tests,
 * the single-task page) this is empty and every facet comes back null.
 */
export function useSuggestionIndex(): SuggestionIndex {
  return useContext(SuggestionContext);
}
