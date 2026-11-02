/**
 * The OS Reduce Motion setting, as a hook that re-renders when it changes.
 *
 * `prefersReducedMotion()` in `lib/use-row-exit.ts` is the synchronous read a
 * tap handler needs. Navigator options are props, so they need the other
 * shape: a value React re-renders on, or the tab bar keeps fading after the
 * setting is switched on until something else happens to re-render it.
 */
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduceMotion = false;
const subscribers = new Set<() => void>();

function set(next: boolean): void {
  if (next === reduceMotion) return;
  reduceMotion = next;
  for (const cb of subscribers) cb();
}

void AccessibilityInfo.isReduceMotionEnabled()
  .then(set)
  .catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', set);

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function snapshot(): boolean {
  return reduceMotion;
}

/** True while the OS asks apps not to animate. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The same value, read outside React. */
export function reduceMotionNow(): boolean {
  return reduceMotion;
}
