"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defaultDisplayFor,
  parseDisplayConfig,
  type DisplayConfig,
} from "@do-done/shared";

const storageKey = (viewKey: string) => `dodone.display.${viewKey}`;

/**
 * Per-view display preferences, persisted to localStorage so each view
 * remembers its own sort/group/filter (Todoist-style). The DB-backed,
 * cross-device version is a later phase — this keeps the feature instant and
 * backend-free for now.
 *
 * SSR safety: first render (server + client) uses the view's default config;
 * the persisted value is loaded in an effect after mount, so there's no
 * hydration mismatch.
 */
export function useDisplayConfig(viewKey: string) {
  const fallback = useMemo(() => defaultDisplayFor(viewKey), [viewKey]);
  const [config, setConfigState] = useState<DisplayConfig>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(viewKey));
      if (raw) setConfigState(parseDisplayConfig(JSON.parse(raw), fallback));
      else setConfigState(fallback);
    } catch {
      setConfigState(fallback);
    }
    setHydrated(true);
  }, [viewKey, fallback]);

  const setConfig = useCallback(
    (next: DisplayConfig) => {
      setConfigState(next);
      try {
        localStorage.setItem(storageKey(viewKey), JSON.stringify(next));
      } catch {
        // localStorage can throw in private mode / quota — non-fatal.
      }
    },
    [viewKey]
  );

  const reset = useCallback(() => {
    setConfigState(fallback);
    try {
      localStorage.removeItem(storageKey(viewKey));
    } catch {
      // ignore
    }
  }, [viewKey, fallback]);

  const isDefault = useMemo(
    () => JSON.stringify(config) === JSON.stringify(fallback),
    [config, fallback]
  );

  return { config, setConfig, reset, hydrated, isDefault };
}
