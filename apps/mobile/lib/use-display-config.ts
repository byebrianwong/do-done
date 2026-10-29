import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultDisplayFor,
  isDisplayDefault,
  parseDisplayConfig,
  type DisplayConfig,
} from '@do-done/shared';
import { getUserPrefsApi } from '@/lib/supabase';
import {
  hasDisplayConfig,
  initialDisplayConfig,
  markDisplayConfigWritten,
  rememberDisplayConfig,
  sameDisplayConfig,
  shouldApplyRemoteConfig,
} from '@/lib/display-config-cache';

const STORAGE_PREFIX = 'dodone.display.';
const storageKey = (viewKey: string) => `${STORAGE_PREFIX}${viewKey}`;

/**
 * Fill the in-memory cache from AsyncStorage once, at launch, so the first
 * mount of each view already has its saved config rather than drawing the
 * defaults and regrouping when its own read lands. Called from the root
 * layout. Never overwrites a view that has already answered for itself.
 */
export async function hydrateDisplayConfigs(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) =>
      k.startsWith(STORAGE_PREFIX)
    );
    if (keys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [key, raw] of pairs) {
      if (!raw) continue;
      const viewKey = key.slice(STORAGE_PREFIX.length);
      if (hasDisplayConfig(viewKey)) continue;
      const fallback = defaultDisplayFor(viewKey);
      rememberDisplayConfig(viewKey, parseDisplayConfig(JSON.parse(raw), fallback));
    }
  } catch {
    // Each view still reads its own config on mount.
  }
}

/**
 * Per-view display preferences with cross-device sync — the mobile twin of the
 * web hook (same storage-key shape + shared engine).
 *
 * Two-tier persistence: AsyncStorage is the instant cache; the
 * user_preferences.display_prefs DB column is the source of truth that follows
 * the user across web + mobile. On mount we paint from AsyncStorage, then
 * reconcile from the DB. Writes go to both — AsyncStorage immediately, the DB
 * debounced. Degrades to local-only if the DB is unreachable.
 *
 * A mount starts from the config this view last used this launch
 * (`lib/display-config-cache.ts`), not from the defaults, and a read that
 * agrees with what is showing changes nothing. Without that a customised list
 * drew in the default grouping and regrouped a moment later on every mount.
 */
export function useDisplayConfig(viewKey: string) {
  const fallback = useMemo(() => defaultDisplayFor(viewKey), [viewKey]);
  const [config, setConfigState] = useState<DisplayConfig>(() =>
    initialDisplayConfig(viewKey, fallback)
  );
  // Sets state only when the config would draw differently, and records it
  // as what this view last used.
  const show = useCallback(
    (next: DisplayConfig) => {
      rememberDisplayConfig(viewKey, next);
      setConfigState((prev) => (sameDisplayConfig(prev, next) ? prev : next));
    },
    [viewKey]
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Once the user changes anything, the async DB read must not clobber it.
  const dirtyRef = useRef(false);

  useEffect(() => {
    let active = true;
    dirtyRef.current = false;
    // A different view under the same hook starts from that view's config.
    setConfigState((prev) => {
      const start = initialDisplayConfig(viewKey, fallback);
      return sameDisplayConfig(prev, start) ? prev : start;
    });
    // 1. Instant: AsyncStorage cache.
    AsyncStorage.getItem(storageKey(viewKey))
      .then((raw) => {
        if (active && raw && !dirtyRef.current) {
          show(parseDisplayConfig(JSON.parse(raw), fallback));
        }
      })
      .catch(() => {});
    // 2. Reconcile from the DB (source of truth), unless the user already acted.
    void (async () => {
      try {
        const api = await getUserPrefsApi();
        const { data, error } = await api.getDisplayPrefs();
        if (!active || error || dirtyRef.current) return;
        if (!shouldApplyRemoteConfig(viewKey)) return;
        const dbVal = data[viewKey];
        if (dbVal === undefined) return;
        const parsed = parseDisplayConfig(dbVal, fallback);
        show(parsed);
        AsyncStorage.setItem(storageKey(viewKey), JSON.stringify(parsed)).catch(() => {});
      } catch {
        // DB unreachable / migration not applied — stay on the local cache.
      }
    })();
    return () => {
      active = false;
    };
  }, [viewKey, fallback, show]);

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
      markDisplayConfigWritten(viewKey);
      rememberDisplayConfig(viewKey, next);
      setConfigState(next);
      AsyncStorage.setItem(storageKey(viewKey), JSON.stringify(next)).catch(() => {});
      persistDb(next);
    },
    [viewKey, persistDb]
  );

  const reset = useCallback(() => {
    dirtyRef.current = true;
    markDisplayConfigWritten(viewKey);
    rememberDisplayConfig(viewKey, fallback);
    setConfigState(fallback);
    AsyncStorage.removeItem(storageKey(viewKey)).catch(() => {});
    persistDb(fallback);
  }, [viewKey, fallback, persistDb]);

  // Ignores `collapsed` (see isDisplayDefault) so collapsing a section isn't
  // treated as a customization.
  const isDefault = useMemo(
    () => isDisplayDefault(config, fallback),
    [config, fallback]
  );

  return { config, setConfig, reset, isDefault };
}
