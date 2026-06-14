import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  defaultDisplayFor,
  parseDisplayConfig,
  type DisplayConfig,
} from '@do-done/shared';

const storageKey = (viewKey: string) => `dodone.display.${viewKey}`;

/**
 * Per-view display preferences persisted to AsyncStorage — the mobile twin of
 * the web hook, sharing the same storage key shape and shared DisplayConfig
 * engine so behaviour matches across platforms. Loads async after mount;
 * starts from the view's default so first paint is stable.
 */
export function useDisplayConfig(viewKey: string) {
  const fallback = useMemo(() => defaultDisplayFor(viewKey), [viewKey]);
  const [config, setConfigState] = useState<DisplayConfig>(fallback);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey(viewKey))
      .then((raw) => {
        if (active && raw) setConfigState(parseDisplayConfig(JSON.parse(raw), fallback));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [viewKey, fallback]);

  const setConfig = useCallback(
    (next: DisplayConfig) => {
      setConfigState(next);
      AsyncStorage.setItem(storageKey(viewKey), JSON.stringify(next)).catch(() => {});
    },
    [viewKey]
  );

  const reset = useCallback(() => {
    setConfigState(fallback);
    AsyncStorage.removeItem(storageKey(viewKey)).catch(() => {});
  }, [viewKey, fallback]);

  const isDefault = useMemo(
    () => JSON.stringify(config) === JSON.stringify(fallback),
    [config, fallback]
  );

  return { config, setConfig, reset, isDefault };
}
