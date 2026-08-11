import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextLayoutLine,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  TASK_COMPLETE_STRIKE_DELAY_MS,
  TASK_COMPLETE_STRIKE_MS,
} from '@do-done/shared';
import { LinkifiedText } from './LinkifiedText';
import { prefersReducedMotion } from '../lib/use-row-exit';

interface StruckTextProps {
  text: string;
  /** True once the task is done — drives the rule being drawn. */
  struck: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Colour of the rule. Matches the struck-out text, not the live text. */
  strikeColor: string;
}

/**
 * A task title whose strike-through is *drawn* rather than switched on.
 *
 * React Native cannot animate `textDecorationLine` — it is a boolean as far as
 * the platform is concerned — so the rule is drawn by hand: `onTextLayout`
 * reports one rect per rendered line, a 1px view is laid over each, and a
 * single clipping container widens from nothing to reveal them all left to
 * right. That is a real platform asymmetry, not a shortcut. Web gets the same
 * gesture from an animated background gradient (`.dd-strike`), which is why
 * the timings live in `@do-done/shared`: the two implementations have nothing
 * else in common and would otherwise drift.
 *
 * One clip for every line, rather than one animation per line, so the number
 * of hooks doesn't depend on how the title happens to wrap.
 */
export function StruckText({
  text,
  struck,
  style,
  numberOfLines,
  strikeColor,
}: StruckTextProps) {
  const [lines, setLines] = useState<TextLayoutLine[]>([]);
  const progress = useSharedValue(struck ? 1 : 0);
  // The clip is measured in pixels, so the widest line is how far it has to
  // travel. Kept on the UI thread rather than in state: it is only ever read
  // by the worklet below.
  const blockWidth = useSharedValue(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      progress.value = struck ? 1 : 0;
      return;
    }
    progress.value = withDelay(
      struck ? TASK_COMPLETE_STRIKE_DELAY_MS : 0,
      withTiming(struck ? 1 : 0, {
        duration: TASK_COMPLETE_STRIKE_MS,
        easing: Easing.out(Easing.cubic),
      })
    );
  }, [struck, progress]);

  const clipStyle = useAnimatedStyle(() => ({
    width: blockWidth.value * progress.value,
  }));

  return (
    <View style={styles.root}>
      <LinkifiedText
        text={text}
        style={style}
        numberOfLines={numberOfLines}
        onTextLayout={(e) => {
          const next = e.nativeEvent.lines;
          blockWidth.value = next.reduce((w, l) => Math.max(w, l.x + l.width), 0);
          // Re-render only when the wrap actually changed. `onTextLayout` fires
          // on every layout pass, and this component sits in a row that
          // re-renders on any task edit.
          setLines((prev) => (sameLines(prev, next) ? prev : next));
        }}
      />
      {/* Non-interactive and out of the accessibility tree: the rule is a
          restatement of the checkbox's state, and a screen reader announcing a
          decoration would be noise. */}
      <Animated.View
        style={[styles.clip, clipStyle]}
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        {lines.map((line, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: line.x,
              // Through the middle of the glyphs rather than the line box —
              // baseline-relative would sit under the descenders.
              top: line.y + line.height * 0.52,
              width: line.width,
              height: StyleSheet.hairlineWidth * 2,
              backgroundColor: strikeColor,
            }}
          />
        ))}
      </Animated.View>
    </View>
  );
}

function sameLines(a: TextLayoutLine[], b: TextLayoutLine[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (l, i) =>
      l.x === b[i].x &&
      l.y === b[i].y &&
      l.width === b[i].width &&
      l.height === b[i].height
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  clip: {
    position: 'absolute',
    // Anchored left/top only — `right` is deliberately unset so the animated
    // width is the one thing deciding how much shows. The whole point: the
    // rules are laid out at full width and revealed by this container growing,
    // so every line draws from its own left edge at once.
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
});
