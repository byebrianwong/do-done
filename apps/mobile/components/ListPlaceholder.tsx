/**
 * What a list draws when it isn't drawing rows.
 *
 * `UpdatingBar` is the "we're checking" signal that sits under a screen's title
 * bar. It self-delays: `useRefreshOnFocus` refires every query on every tab
 * switch, so a bar tied straight to `isFetching` would blink on and off with
 * each tap. Nothing under ~350ms is worth telling the user about. It also stays
 * down for the refetch that follows a write made on this device, which only
 * confirms what the optimistic patch already drew (see `lib/local-write.ts`),
 * and it fades out rather than vanishing mid-sweep.
 *
 * `ListSkeleton` stands in for rows we don't have. It exists so no screen has
 * to fall back to its empty state to fill the gap — "Nothing scheduled today"
 * is an answer, and the app must not give it before it has one. It is drawn in
 * the real list's shape (a section header, then full-width rows with the ring
 * where the ring goes), so the screen does not reshape when the rows arrive,
 * and it fades out over them rather than cutting.
 *
 * `ListError` is what the skeleton turns into when there is nothing left in
 * flight to wait for. Without it the skeleton is the thing that lies instead:
 * an offline launch with no cache would pulse forever.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { isLocalReconcile } from '@/lib/local-write';
import { prefersReducedMotion } from '@/lib/use-row-exit';

/** How long the bar takes to fade out once the refresh is over. */
const BAR_FADE_MS = 220;

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
 * on purpose — a list refresh has no measurable progress, and a bar claiming
 * otherwise visibly stalls.
 */
export function UpdatingBar({ visible }: { visible: boolean }) {
  // Whether this fetch is the reconcile of a local write, decided once as it
  // starts. A write landing halfway through an unrelated refresh must not take
  // the bar down.
  const reconcile = useRef(false);
  const wasVisible = useRef(false);
  if (visible && !wasVisible.current) reconcile.current = isLocalReconcile();
  wasVisible.current = visible;

  const show = useSettled(visible && !reconcile.current, 350);
  // Kept drawn while it fades, so the sweep is not cut off where it stood.
  const [drawn, setDrawn] = useState(false);
  const { width } = useWindowDimensions();
  const segment = Math.max(80, width * 0.35);
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (show) {
      setDrawn(true);
      cancelAnimation(opacity);
      opacity.value = 1;
      progress.value = 0;
      progress.value = withRepeat(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
        -1,
        false
      );
      return;
    }
    if (prefersReducedMotion()) {
      opacity.value = 0;
      cancelAnimation(progress);
      setDrawn(false);
      return;
    }
    opacity.value = withTiming(0, { duration: BAR_FADE_MS });
    // The bar stops being drawn once it has faded, but this component stays
    // mounted — an uncancelled infinite repeat would keep driving the UI
    // thread for the life of the screen with nothing on it to show.
    const t = setTimeout(() => {
      cancelAnimation(progress);
      setDrawn(false);
    }, BAR_FADE_MS);
    return () => clearTimeout(t);
  }, [show, progress, opacity]);

  useEffect(() => () => cancelAnimation(progress), [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: -segment + progress.value * (width + segment) }],
  }));

  // The track keeps its height whether or not the bar is up, so the list below
  // never shifts by 2px when a refresh starts or ends.
  return (
    <View style={styles.track}>
      {drawn ? (
        <Animated.View style={[styles.segment, { width: segment }, style]} />
      ) : null}
    </View>
  );
}

/** Varied title widths, so a column of placeholders reads as content rather
 *  than as a repeating pattern. */
const TITLE_WIDTHS = ['78%', '54%', '66%', '43%', '71%', '59%'] as const;

/**
 * One placeholder row, shaped like the row it stands in for. `rows` is a
 * TaskItem: full width, the ring after the urgency gutter, a hairline under
 * it. `cards` is the inset rounded card the Lists and Tags indexes draw.
 */
function SkeletonRow({ index, variant }: { index: number; variant: SkeletonVariant }) {
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
    <Animated.View style={[variant === 'cards' ? styles.card : styles.row, style]}>
      <View style={styles.checkbox} />
      <View style={styles.rowText}>
        <View style={[styles.line, { width: titleWidth }]} />
        <View style={[styles.line, styles.metaLine]} />
      </View>
    </Animated.View>
  );
}

type SkeletonVariant = 'rows' | 'cards';

export function ListSkeleton({
  rows = 5,
  variant = 'rows',
  header = variant === 'rows',
}: {
  rows?: number;
  variant?: SkeletonVariant;
  /** A section header above the rows, where the real list has one. */
  header?: boolean;
}) {
  return (
    // Fades out as the list replaces it. The fading copy is drawn over the
    // rows that just mounted in its place, so the two cross rather than cut.
    <Animated.View
      exiting={FadeOut.duration(180)}
      style={variant === 'cards' ? styles.skeletonCards : undefined}
      accessibilityLabel="Loading tasks"
    >
      {header ? (
        <View style={styles.header}>
          <View style={[styles.line, styles.headerLine]} />
        </View>
      ) : null}
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} index={i} variant={variant} />
      ))}
    </Animated.View>
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
  skeletonCards: { paddingTop: 8 },
  // TaskItem's geometry, kept by hand: 11px vertical padding, 22px before the
  // ring (its 8px padding, the 10px urgency gutter and the gutter's 4px
  // margin), and 11px between the ring and the title.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#fff',
    paddingLeft: 22,
    paddingRight: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  card: {
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
  // `SectionHeader`'s padding, with a bar where the label goes.
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  headerLine: { width: 72, height: 12 },
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
