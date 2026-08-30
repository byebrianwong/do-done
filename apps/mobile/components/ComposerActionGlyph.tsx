import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { prefersReducedMotion } from '../lib/use-row-exit';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The gutter the glyph sits in at either end, matching the field's padding. */
export const GLYPH_PAD = 12;
/** The glyph's own box. */
export const GLYPH_SIZE = 20;
/**
 * What the field keeps clear at each end: the glyph plus a hair of room,
 * so the "N added" receipt does not end exactly where the return key
 * begins. The field reserves it at both ends, since the glyph parks at
 * whichever one the composer is not using.
 */
export const GLYPH_CLEARANCE = GLYPH_SIZE + 6;

const SLIDE_MS = 220;

/**
 * The one control in a composer that says what happens next.
 *
 * At rest it is a plus at the leading edge, and tapping it focuses the field.
 * While the field is live it slides to the trailing edge and turns into a
 * return key: grey until there is something to commit, indigo and tappable
 * once there is.
 *
 * It replaced a plain `add` icon that did nothing. Every other plus in DoDone
 * is a button — the add button, the Lists +, the Projects + — so an inert one
 * is a promise the app does not keep.
 *
 * The keyboard already draws a return key, so on a phone this is not new
 * information. It earns its place as a target: the thumb is at the field, not
 * at the bottom of the keyboard, and the glyph says which way the field is
 * facing before anything is typed.
 *
 * Web draws the same control in `components/composer-action-glyph.tsx`. The
 * two share no code — a Reanimated transform against a CSS `left` transition —
 * but they must not drift in what the symbol means at each end.
 */
export function ComposerActionGlyph({
  width,
  active,
  armed,
  onSubmit,
  onFocusField,
  idleLabel,
  submitLabel,
}: {
  /** The field's measured width, from the parent's `onLayout`. */
  width: number;
  /** The field is focused or already holds text, so the glyph sits right. */
  active: boolean;
  /** There is something to commit, so the return key is live. */
  armed: boolean;
  onSubmit: () => void;
  onFocusField: () => void;
  idleLabel: string;
  submitLabel: string;
}) {
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      // Reduce motion lands on the end state rather than switching the move
      // off. Something did happen — the field took focus and the symbol
      // changed meaning — so the glyph still has to be at the trailing edge.
      duration: prefersReducedMotion() ? 0 : SLIDE_MS,
      easing: Easing.bezier(0.2, 0, 0, 1),
    });
  }, [active, progress]);

  const travel = Math.max(0, width - GLYPH_PAD * 2 - GLYPH_SIZE);

  const slide = useAnimatedStyle(
    () => ({ transform: [{ translateX: progress.value * travel }] }),
    [travel]
  );
  /*
    The two glyphs crossfade across the middle of the slide rather than at
    either end of it. Swapping on the first frame reads as two symbols, one
    replacing the other, instead of one that moved and changed its mind.
  */
  const plusStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.value,
      [0, 0.45],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));
  const returnStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.value,
      [0.55, 1],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  return (
    <AnimatedPressable
      style={[styles.root, slide]}
      onPress={() => {
        if (active && armed) onSubmit();
        onFocusField();
      }}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={active && armed ? submitLabel : idleLabel}
    >
      <Animated.View style={[styles.layer, plusStyle]}>
        <Ionicons name="add" size={GLYPH_SIZE} color="#6366f1" />
      </Animated.View>
      <Animated.View style={[styles.layer, returnStyle]}>
        <Ionicons
          name="return-down-back"
          size={GLYPH_SIZE}
          // The placeholder's own grey, so the dim return key and the
          // placeholder beside it read as one empty state.
          color={armed ? '#6366f1' : '#9ca3af'}
        />
      </Animated.View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // Absolute, and stretched top to bottom so the glyph centres against
  // whatever height the field ends up with.
  root: {
    position: 'absolute',
    left: GLYPH_PAD,
    top: 0,
    bottom: 0,
    width: GLYPH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: { position: 'absolute' },
});
