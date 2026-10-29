import React, { useEffect } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ROW_ARRIVE_MS, prefersReducedMotion } from '@/lib/use-row-exit';

const UNCLAMPED = 10_000;

/**
 * Folds its content shut when `departing` turns true: height to zero and a
 * fade, over the same {@link ROW_ARRIVE_MS} a row takes. For a section header
 * the list is about to stop drawing (`useSectionTransitions` keeps it as a
 * ghost for exactly that long). A task row does this through `useRowExit`
 * instead, which it already carries.
 *
 * The height is read from an inner view, which keeps its natural height while
 * the outer one is clamped. Reduce motion does nothing: the header goes with
 * the data, as it always did.
 */
export function FoldAway({
  departing,
  children,
}: {
  departing: boolean;
  children: React.ReactNode;
}) {
  const height = useSharedValue(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!departing || prefersReducedMotion()) return;
    progress.value = withTiming(1, {
      duration: ROW_ARRIVE_MS,
      easing: Easing.out(Easing.quad),
    });
  }, [departing, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    maxHeight:
      progress.value === 0 ? UNCLAMPED : height.value * (1 - progress.value),
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    height.value = e.nativeEvent.layout.height;
  };

  return (
    <Animated.View style={[departing && styles.crop, style]}>
      <View onLayout={onLayout} collapsable={false}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  crop: { overflow: 'hidden' },
});
