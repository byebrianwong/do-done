"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultDisplayFor,
  isDisplayDefault,
  parseDisplayConfig,
  type DisplayConfig,
} from "@do-done/shared";
import { getClientUserPrefsApi } from "./supabase/user-prefs-client";

const storageKey = (viewKey: string) => `dodone.display.${viewKey}`;

/**
 * Per-view display preferences, synced across devices.
 *
 * Two-tier persistence: localStorage is the instant cache (no flash on load,
 * works offline); the user_preferences.display_prefs DB column is the source of
 * truth that follows the user across web + mobile. On mount we paint from
 * localStorage immediately, then reconcile from the DB. Writes go to both —
 * localStorage synchronously, the DB debounced. If the DB is unreachable (or
 * the migration hasn't run yet) it degrades gracefully to localStorage-only.
 *
 * SSR safety: first render uses the view's default; persisted values load in an
 * effect after mount, so there's no hydration mismatch.
 */
export function useDisplayConfig(viewKey: string) {
  const fallback = useMemo(() => defaultDisplayFor(viewKey), [viewKey]);
  const [config, setConfigState] = useState<DisplayConfig>(fallback);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Once the user changes anything, the async DB read must not clobber it.
  const dirtyRef = useRef(false);

  useEffect(() => {
    let active = true;
    dirtyRef.current = false;
    // 1. Instant: localStorage cache.
    try {
      const raw = localStorage.getItem(storageKey(viewKey));
      setConfigState(raw ? parseDisplayConfig(JSON.parse(raw), fallback) : fallback);
    } catch {
      setConfigState(fallback);
    }
    setHydrated(true);
    // 2. Reconcile from the DB (source of truth), unless the user already acted.
    void (async () => {
      try {
        const api = await getClientUserPrefsApi();
        const { data, error } = await api.getDisplayPrefs();
        if (!active || error || dirtyRef.current) return;
        const dbVal = data[viewKey];
        if (dbVal === undefined) return;
        const parsed = parseDisplayConfig(dbVal, fallback);
        setConfigState(parsed);
        try {
          localStorage.setItem(storageKey(viewKey), JSON.stringify(parsed));
        } catch {
          // ignore cache write failure
        }
      } catch {
        // DB unreachable / migration not applied — stay on the local cache.
      }
    })();
    return () => {
      active = false;
    };
  }, [viewKey, fallback]);

  // Debounced write-through so rapid menu toggles coalesce into one DB write.
  const persistDb = useCallback(
    (next: DisplayConfig) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            const api = await getClientUserPrefsApi();
            await api.setDisplayPref(viewKey, next);
          } catch {
            // best-effort — localStorage already holds the change
          }
        })();
      }, 500);
    },
    [viewKey]
  );

  const setConfig = useCallback(
    (next: DisplayConfig) => {
      dirtyRef.current = true;
      setConfigState(next);
      try {
        localStorage.setItem(storageKey(viewKey), JSON.stringify(next));
      } catch {
        // localStorage can throw in private mode / quota — non-fatal.
      }
      persistDb(next);
    },
    [viewKey, persistDb]
  );

  const reset = useCallback(() => {
    dirtyRef.current = true;
    setConfigState(fallback);
    try {
      localStorage.removeItem(storageKey(viewKey));
    } catch {
      // ignore
    }
    persistDb(fallback);
  }, [viewKey, fallback, persistDb]);

  // Ignores `collapsed` — collapsing a section isn't a sort/group/filter change,
  // so it shouldn't light the "customized" dot or show Reset.
  const isDefault = useMemo(
    () => isDisplayDefault(config, fallback),
    [config, fallback]
  );

  return { config, setConfig, reset, hydrated, isDefault };
}
