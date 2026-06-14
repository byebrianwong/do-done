import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultDisplayFor,
  parseDisplayConfig,
  type DisplayConfig,
} from '@do-done/shared';
import { getUserPrefsApi } from '@/lib/supabase';

const storageKey = (viewKey: string) => `dodone.display.${viewKey}`;

/**
 * Per-view display preferences with cross-device sync — the mobile twin of the
 * web hook (same storage-key shape + shared engine).
 *
 * Two-tier persistence: AsyncStorage is the instant cache; the
 * user_preferences.display_prefs DB column is the source of truth that follows
 * the user across web + mobile. On mount we paint from AsyncStorage, then
 * reconcile from the DB. Writes go to both — AsyncStorage immediately, the DB
 * debounced. Degrades to local-only if the DB is unreachable.
 */
export function useDisplayConfig(viewKey: string) {
  const fallback = useMemo(() => defaultDisplayFor(viewKey), [viewKey]);
  const [config, setConfigState] = useState<DisplayConfig>(fallback);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Once the user changes anything, the async DB read must not clobber it.
  const dirtyRef = useRef(false);

  useEffect(() => {
    let active = true;
    dirtyRef.current = false;
    // 1. Instant: AsyncStorage cache.
    AsyncStorage.getItem(storageKey(viewKey))
      .then((raw) => {
        if (active && raw && !dirtyRef.current) {
          setConfigState(parseDisplayConfig(JSON.parse(raw), fallback));
        }
      })
      .catch(() => {});
    // 2. Reconcile from the DB (source of truth), unless the user already acted.
    void (async () => {
      try {
        const api = await getUserPrefsApi();
        const { data, error } = await api.getDisplayPrefs();
        if (!active || error || dirtyRef.current) return;
        const dbVal = data[viewKey];
        if (dbVal === undefined) return;
        const parsed = parseDisplayConfig(dbVal, fallback);
        setConfigState(parsed);
        AsyncStorage.setItem(storageKey(viewKey), JSON.stringify(parsed)).catch(() => {});
      } catch {
        // DB unreachable / migration not applied — stay on the local cache.
      }
    })();
    return () => {
      active = false;
    };
  }, [viewKey, fallback]);

  const persistDb = useCallback(
    (next: DisplayConfig) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            const api = await getUserPrefsApi();
            await api.setDisplayPref(viewKey, next);
          } catch {
            // best-effort — AsyncStorage already holds the change
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
      AsyncStorage.setItem(storageKey(viewKey), JSON.stringify(next)).catch(() => {});
      persistDb(next);
    },
    [viewKey, persistDb]
  );

  const reset = useCallback(() => {
    dirtyRef.current = true;
    setConfigState(fallback);
    AsyncStorage.removeItem(storageKey(viewKey)).catch(() => {});
    persistDb(fallback);
  }, [viewKey, fallback, persistDb]);

  const isDefault = useMemo(
    () => JSON.stringify(config) === JSON.stringify(fallback),
    [config, fallback]
  );

  return { config, setConfig, reset, isDefault };
}
