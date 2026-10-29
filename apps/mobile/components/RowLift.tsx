import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useOnCellActiveAnimation } from 'react-native-draggable-flatlist';

import { prefersReducedMotion } from '@/lib/use-row-exit';

/**
 * The lift a task row gets when it is picked up to drag.
 *
 * It used to swap to a grey background at 90% opacity in one frame, which read
 * as the row being disabled rather than held. Now it grows slightly and takes
 * a shadow, on the library's own spring, and settles back the same way when
 * it is put down. The Projects tab has done this since it was written, through
 * the library's `ScaleDecorator`; this is that, with a shadow and a smaller
 * scale, since a task row is full width and 10% would push it off both edges.
 *
 * Driven by `useOnCellActiveAnimation`, a shared value the library springs on
 * the UI thread. Must be rendered inside a `DraggableFlatList` cell.
 *
 * Reduce motion keeps the old static tint, so a held row still looks held.
 */
const LIFT_SCALE = 1.02;
/** Module-level: the hook copies it into a shared value whenever it changes. */
const LIFT_SPRING = { mass: 0.1 };

export function RowLift({
  isActive,
  children,
}: {
  isActive: boolean;
  children: React.ReactNode;
}) {
  const { onActiveAnim } = useOnCellActiveAnimation({
    animationConfig: LIFT_SPRING,
  });
  const reduce = prefersReducedMotion();

  const style = useAnimatedStyle(() => {
    if (reduce) return {};
    const p = onActiveAnim.value;
    const lifted = p > 0.01;
    return {
      transform: [{ scale: interpolate(p, [0, 1], [1, LIFT_SCALE]) }],
      shadowColor: '#111827',
      shadowOpacity: p * 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: lifted ? 6 : 0,
    };
  }, [reduce]);

  if (reduce) {
    return <View style={isActive ? styles.activeStatic : undefined}>{children}</View>;
  }
  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  activeStatic: { opacity: 0.9, backgroundColor: '#f1f5f9' },
});
