/**
 * Puts the back animation back on a screen the tab-resume pushed silently.
 *
 * A native stack screen's `animation` is used for its pop as well as its push.
 * A restore pushes with `none` (see `RESUME_PARAM` in `lib/tab-resume.ts`), so
 * without this the back button and the tab re-tap would also cut straight to
 * the index. Once the screen has appeared, its animation is reset to the
 * default, which only the pop can still use.
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';

import { RESUME_PARAM, resumeScreenAnimation } from '@/lib/tab-resume';

interface StackNavigation {
  addListener(type: 'transitionEnd', cb: () => void): () => void;
  setOptions(options: { animation: 'default' }): void;
}

/**
 * Fallback for a `transitionEnd` that never arrives. A screen pushed with no
 * animation has appeared well before this.
 */
const SETTLE_FALLBACK_MS = 800;

export function useResumeArrival(): void {
  const navigation = useNavigation() as unknown as StackNavigation;
  const params = useLocalSearchParams<Record<string, string>>();
  const quiet = resumeScreenAnimation({ [RESUME_PARAM]: params[RESUME_PARAM] }) === 'none';

  useEffect(() => {
    if (!quiet) return;
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      navigation.setOptions({ animation: 'default' });
    };
    const unsubscribe = navigation.addListener('transitionEnd', settle);
    const timer = setTimeout(settle, SETTLE_FALLBACK_MS);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [quiet, navigation]);
}
