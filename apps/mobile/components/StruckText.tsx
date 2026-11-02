import React, { useEffect, useReducer, useRef, useState } from 'react';
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
 *
 * The clip moves by transform, not by width. An outer view slides in from the
 * left and an inner one slides back by the same amount, so the rules stay
 * where they were laid out and the outer view's clipped edge sweeps across
 * them. That reveals each line from its own left edge exactly as a widening
 * clip did, multi-line titles included, without laying anything out per frame.
 * A `scaleX` would be cheaper still but stretches every rule from the same
 * origin, so a short line would finish at the same moment as a long one.
 *
 * The line rects are kept in a ref until the row is first struck. Every row
 * reports its layout on mount, and putting that in state cost each row a second
 * render that drew nothing, since the rules are invisible until completion.
 */
export function StruckText({
  text,
  struck,
  style,
  numberOfLines,
  strikeColor,
}: StruckTextProps) {
  const linesRef = useRef<TextLayoutLine[]>(NO_LINES);
  // Whether the rules have ever been needed in this mount. Sticky, so an
  // un-tick can still play the rule back out before it is hidden at width 0.
  const [drawn, setDrawn] = useState(struck);
  if (struck && !drawn) setDrawn(true);
  const drawnRef = useRef(drawn);
  drawnRef.current = drawn;
  // A re-render for a wrap change that arrives once the rules are drawn.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const lines = drawn ? linesRef.current : NO_LINES;
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

  // The outer view's right edge sits at `progress × width`; the inner view
  // cancels the shift so the rules themselves never move.
  const clipStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * blockWidth.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * blockWidth.value }],
  }));

  return (
    <View style={styles.root}>
      <LinkifiedText
        text={text}
        style={style}
        numberOfLines={numberOfLines}
        onTextLayout={(e) => {
          const next = e.nativeEvent.lines;
          blockWidth.value = widestLine(next);
          if (sameLines(linesRef.current, next)) return;
          linesRef.current = next;
          // Re-render only when the rules are on screen and the wrap actually
          // changed. `onTextLayout` fires on every layout pass, and this
          // component sits in a row that re-renders on any task edit.
          if (drawnRef.current) redraw();
        }}
      />
      {/* Non-interactive and out of the accessibility tree: the rule is a
          restatement of the checkbox's state, and a screen reader announcing a
          decoration would be noise. */}
      {drawn ? (
        <Animated.View
          style={[styles.clip, { width: widestLine(lines) }, clipStyle]}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
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
        </Animated.View>
      ) : null}
    </View>
  );
}

const NO_LINES: TextLayoutLine[] = [];

/** How far the clip has to travel: the right edge of the widest line. */
function widestLine(lines: TextLayoutLine[]): number {
  return lines.reduce((w, l) => Math.max(w, l.x + l.width), 0);
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
  // This view is the one that fills the row, so `flex: 1` belongs *here* — its
  // parent (`titleRow`) lays out horizontally, so that means width.
  //
  // It must not also be on the text style handed in as `style`: this root is a
  // column container, so a `flex: 1` on the Text inside it reads as
  // `flexBasis: 0` **vertically** and collapses the title to zero height. See
  // the note on `title` in TaskItem.
  root: { flex: 1 },
  clip: {
    position: 'absolute',
    // Anchored left/top only, and as wide as the widest line. The rules are
    // laid out at full width and revealed by this container sliding in from
    // the left (see the transforms above), so every line draws from its own
    // left edge at once.
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
});
