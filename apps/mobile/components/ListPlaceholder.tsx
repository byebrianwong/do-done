/**
 * What a list draws when it isn't drawing rows.
 *
 * `UpdatingBar` is the "we're checking" signal that sits under a screen's title
 * bar. It self-delays: `useRefreshOnFocus` refires every query on every tab
 * switch, so a bar tied straight to `isFetching` would blink on and off with
 * each tap. Nothing under ~350ms is worth telling the user about.
 *
 * `ListSkeleton` stands in for rows we don't have. It exists so no screen has
 * to fall back to its empty state to fill the gap — "Nothing scheduled today"
 * is an answer, and the app must not give it before it has one.
 *
 * `ListError` is what the skeleton turns into when there is nothing left in
 * flight to wait for. Without it the skeleton is the thing that lies instead:
 * an offline launch with no cache would pulse forever.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const ACCENT = '#6366f1';
const PLACEHOLDER = '#e5e7eb';

/** True only once `active` has held for `delayMs` — drops sub-perceptual blips. */
function useSettled(active: boolean, delayMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!active) {
      setSettled(false);
      return;
    }
    const t = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return settled;
}

/**
 * A 2px indeterminate bar: a short segment sweeping left to right. Indeterminate
 * on purpose — a list refresh has no measurable progress, and a bar that
 * pretends otherwise is a lie the user can see stalling.
 */
export function UpdatingBar({ visible }: { visible: boolean }) {
  const show = useSettled(visible, 350);
  const { width } = useWindowDimensions();
  const segment = Math.max(80, width * 0.35);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!show) return;
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      -1,
      false
    );
    // The bar stops being rendered when the refresh ends, but this component
    // stays mounted — an uncancelled infinite repeat would keep driving the UI
    // thread for the life of the screen with nothing on it to show.
    return () => cancelAnimation(progress);
  }, [show, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -segment + progress.value * (width + segment) }],
  }));

  // The track keeps its height whether or not the bar is up, so the list below
  // never shifts by 2px when a refresh starts or ends.
  return (
    <View style={styles.track}>
      {show ? (
        <Animated.View style={[styles.segment, { width: segment }, style]} />
      ) : null}
    </View>
  );
}

/** Varied title widths, so a column of placeholders reads as content rather
 *  than as a repeating pattern. */
const TITLE_WIDTHS = ['78%', '54%', '66%', '43%', '71%', '59%'] as const;

/** One placeholder row, shaped like a TaskItem: checkbox, title, meta line. */
function SkeletonRow({ index }: { index: number }) {
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const titleWidth = TITLE_WIDTHS[index % TITLE_WIDTHS.length];

  return (
    <Animated.View style={[styles.row, style]}>
      <View style={styles.checkbox} />
      <View style={styles.rowText}>
        <View style={[styles.line, { width: titleWidth }]} />
        <View style={[styles.line, styles.metaLine]} />
      </View>
    </Animated.View>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading tasks">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} index={i} />
      ))}
    </View>
  );
}

/** Nothing cached and the fetch failed — say so, and offer the way out. */
export function ListError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>Couldn’t load your tasks</Text>
      <Text style={styles.errorHint}>
        You may be offline. Your tasks are safe.
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
      >
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 2, overflow: 'hidden', backgroundColor: 'transparent' },
  segment: { height: 2, borderRadius: 1, backgroundColor: ACCENT },
  skeleton: { paddingTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: PLACEHOLDER,
  },
  rowText: { flex: 1, gap: 7 },
  line: { height: 10, borderRadius: 5, backgroundColor: PLACEHOLDER },
  metaLine: { width: '28%', height: 8 },
  error: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  errorText: { fontSize: 16, fontWeight: '600', color: '#6b7280' },
  errorHint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
  retry: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  retryPressed: { opacity: 0.8 },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
