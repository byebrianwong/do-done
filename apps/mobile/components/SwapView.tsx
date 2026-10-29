/**
 * The body of a swap tab: one of two views, crossfaded when it changes.
 *
 * Only the view on screen is mounted. Keeping both mounted would keep the
 * scroll position of the half you left, but it doubles the render cost of the
 * tab — both views' queries stay live and both re-render on every cache write —
 * to save a scroll position that is usually near the top anyway, and that the
 * data underneath has often moved by the time you swap back. So the old view
 * is unmounted from React the moment the swap commits, and Reanimated keeps
 * its last frame on screen only for the fade (an `exiting` animation runs on
 * the native views React has already let go of).
 *
 * The swap renders twice, before one paint. The outgoing view's `exiting`
 * animation is a prop, so it has to be set to this swap's direction on a
 * render *before* the one that unmounts it. The first render does that; a
 * layout effect then swaps the key. The view element itself is memoised per
 * mode, so the first render does not re-render the outgoing view's tree.
 */
import React, { useLayoutEffect, useMemo, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeInLeft,
  FadeInRight,
  FadeOutLeft,
  FadeOutRight,
} from 'react-native-reanimated';

import { reduceMotionNow } from '@/lib/reduce-motion';
import { SWAP_FADE_MS, swapTransition, type SwapTransition } from '@/lib/swap-motion';
import { modeChangeCause } from '@/lib/view-mode';

interface Props<M extends string> {
  tab: 'agenda' | 'tasks';
  mode: M;
  order: readonly M[];
  render: (mode: M) => ReactElement;
}

function enteringFor(t: SwapTransition | null) {
  if (!t || !t.animate) return undefined;
  return (t.direction === 'forward' ? FadeInRight : FadeInLeft).duration(SWAP_FADE_MS);
}

function exitingFor(t: SwapTransition | null) {
  if (!t || !t.animate) return undefined;
  return (t.direction === 'forward' ? FadeOutLeft : FadeOutRight).duration(SWAP_FADE_MS);
}

export function SwapView<M extends string>({ tab, mode, order, render }: Props<M>) {
  const [shown, setShown] = useState<{ mode: M; transition: SwapTransition | null }>({
    mode,
    // Nothing to animate from on the first mount.
    transition: null,
  });

  // The outgoing view's transition, decided on the render where the mode first
  // differs from what is shown.
  const pending =
    mode === shown.mode
      ? null
      : swapTransition({
          order,
          from: shown.mode,
          to: mode,
          cause: modeChangeCause(tab),
          reduceMotion: reduceMotionNow(),
        });

  useLayoutEffect(() => {
    if (mode !== shown.mode) setShown({ mode, transition: pending });
  }, [mode, shown.mode, pending]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const body = useMemo(() => render(shown.mode), [shown.mode]);

  return (
    <View style={styles.root}>
      <Animated.View
        key={shown.mode}
        style={StyleSheet.absoluteFill}
        entering={enteringFor(shown.transition)}
        exiting={exitingFor(pending)}
      >
        {body}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
