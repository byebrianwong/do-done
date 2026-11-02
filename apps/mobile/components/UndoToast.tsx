import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UNDO_TOAST_TTL_MS } from '@do-done/shared';

import { useVisibleTabBarProgress } from '@/lib/tab-bar-minimize';
import { tabRowHeight } from '@/lib/tab-bar-motion';
import {
  TOAST_FADE_MS,
  TOAST_FAB_CLEARANCE,
  TOAST_GAP,
  TOAST_RISE_PX,
  riseStart,
  shouldUnmountAfterFade,
  toastBottom,
  toastLift,
  toastShowMode,
} from '@/lib/undo-toast-motion';
import { prefersReducedMotion } from '@/lib/use-row-exit';

type Toast = {
  id: number;
  message: string;
  /**
   * Omitted for a toast that only reports something (an undo that failed).
   * A dead "Undo" is worse than none: the user taps it, nothing happens, and
   * the app has told them twice that it did something it didn't.
   */
  undo?: () => void | Promise<void>;
};

type Ctx = { show: (t: Omit<Toast, 'id'>) => void };

const UndoToastContext = createContext<Ctx | null>(null);

const RISE_SPRING = { damping: 16, stiffness: 220 };

/**
 * The context carries only `show`, and both it and the value object are
 * stable, so a toast going up or down re-renders no consumer.
 *
 * Every task row, list row and the root navigator read this context, and
 * context ignores `React.memo`. The value used to be a new `{ show }` on every
 * provider render, and the provider rendered on every show and every dismiss,
 * so each toast re-rendered every row on screen twice. The completion toast
 * goes up while the row it is about is still animating out. The toast's own
 * state now lives in `ToastHost`, and the provider holds none.
 */
export function UndoToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const hostRef = useRef<ToastHostHandle>(null);
  const show = useCallback<Ctx['show']>((t) => {
    hostRef.current?.show(t);
  }, []);
  const value = useMemo<Ctx>(() => ({ show }), [show]);

  return (
    <UndoToastContext.Provider value={value}>
      {children}
      <ToastHost ref={hostRef} />
    </UndoToastContext.Provider>
  );
}

type ToastHostHandle = Ctx;

function ToastHost({ ref }: { ref: React.Ref<ToastHostHandle> }) {
  const [toast, setToast] = useState<Toast | null>(null);
  /** The mounted toast's id, readable synchronously from `show`. */
  const currentId = useRef<number | null>(null);
  /** The id of a toast that is fading out, so Undo cannot fire twice. */
  const fadingId = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const opacity = useSharedValue(0);
  /** 0 at rest, 1 lowered by `TOAST_RISE_PX`. */
  const rise = useSharedValue(1);
  /**
   * 1 → 0 across the undo window, drawn as a bar under the button.
   *
   * The window is the only thing that makes the button useful, and the user
   * cannot see a `setTimeout`. Both are started in the same `show()` call, so
   * the bar and the timer that actually dismisses the toast cannot disagree.
   */
  const countdown = useSharedValue(1);

  const insets = useSafeAreaInsets();
  const tabProgress = useVisibleTabBarProgress();
  // A stand-in so the animated style is not conditional. It never moves,
  // which is right where there is no tab bar.
  const noBar = useSharedValue(0);
  const progress = tabProgress ?? noBar;
  const onTab = tabProgress !== null;
  /**
   * 0 off a tab, 1 on one. Animated, so a toast that is up while the tab bar
   * comes or goes slides to its new height instead of jumping 50pt.
   */
  const onTabProgress = useSharedValue(onTab ? 1 : 0);
  useEffect(() => {
    const target = onTab ? 1 : 0;
    onTabProgress.value = prefersReducedMotion()
      ? target
      : withTiming(target, { duration: TOAST_FADE_MS * 2 });
  }, [onTab, onTabProgress]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const unmountIfCurrent = useCallback(
    (fadedId: number, finished: boolean | undefined) => {
      if (!shouldUnmountAfterFade(finished, fadedId, currentId.current)) return;
      currentId.current = null;
      fadingId.current = null;
      setToast(null);
    },
    []
  );

  const fadeOut = useCallback(
    (id: number) => {
      clearTimer();
      fadingId.current = id;
      if (prefersReducedMotion()) {
        opacity.value = 0;
        unmountIfCurrent(id, true);
        return;
      }
      rise.value = withTiming(1, { duration: TOAST_FADE_MS });
      // The callback also runs when a new `show()` interrupts the fade, with
      // `finished: false`. `shouldUnmountAfterFade` checks both that and the id.
      opacity.value = withTiming(0, { duration: TOAST_FADE_MS }, (finished) => {
        runOnJS(unmountIfCurrent)(id, finished);
      });
    },
    [clearTimer, opacity, rise, unmountIfCurrent]
  );

  const show = useCallback<Ctx['show']>(
    (t) => {
      clearTimer();
      const mode = toastShowMode(currentId.current !== null, prefersReducedMotion());
      const id = ++idRef.current;
      currentId.current = id;
      fadingId.current = null;
      setToast({ ...t, id });
      // Android reads the toast through its live region. iOS has none, and
      // announcing here also covers a replacement, which does not remount.
      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(t.message);
      }

      if (mode === 'instant') {
        opacity.value = 1;
        rise.value = 0;
      } else {
        // Back to 1 from wherever it is. On a replacement that is already 1,
        // or partway down a fade the new toast interrupted, so the toast never
        // leaves the screen between two receipts.
        opacity.value = withTiming(1, { duration: TOAST_FADE_MS });
        if (mode === 'enter') {
          // Rises rather than appearing: it arrives while the row it is about
          // is still leaving, and two things fading in at once at opposite
          // ends of the screen read as one glitch rather than as cause and
          // receipt.
          rise.value = riseStart(mode);
          rise.value = withSpring(0, RISE_SPRING);
        } else {
          // A small dip and back, so the new text reads as a new receipt.
          rise.value = withSequence(
            withTiming(riseStart(mode), { duration: TOAST_FADE_MS / 2 }),
            withSpring(0, RISE_SPRING)
          );
        }
      }

      // Linear, because this one is reporting a fact rather than expressing a
      // feeling: a window that appeared to slow down near the end would be
      // lying about how much of it is left. Kept under Reduce Motion for the
      // same reason: it is information, not decoration.
      cancelAnimation(countdown);
      countdown.value = 1;
      countdown.value = withTiming(0, {
        duration: UNDO_TOAST_TTL_MS,
        easing: Easing.linear,
      });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (currentId.current === id) fadeOut(id);
      }, UNDO_TOAST_TTL_MS);
    },
    [clearTimer, countdown, fadeOut, opacity, rise]
  );

  useImperativeHandle(ref, () => ({ show }), [show]);

  useEffect(() => clearTimer, [clearTimer]);

  // On a tab screen the toast is raised by the bar's current row height, so it
  // stays level with the add button as the bar minimizes. A transform rather
  // than an animated `bottom`, so following the bar costs no layout.
  const wrapStyle = useAnimatedStyle(
    () => ({
      opacity: opacity.value,
      transform: [
        {
          translateY:
            rise.value * TOAST_RISE_PX -
            toastLift(onTabProgress.value, tabRowHeight(progress.value)),
        },
      ],
    }),
    [progress]
  );

  const countdownStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -UNDO_BTN_WIDTH / 2 },
      { scaleX: countdown.value },
      { translateX: UNDO_BTN_WIDTH / 2 },
    ],
  }));

  if (!toast) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          bottom: toastBottom(insets.bottom),
          // Every tab screen has the add button in the bottom-right corner, at
          // the same height. Beside it rather than on top of it. Left-aligned
          // everywhere, so this inset only caps the width and a toast that
          // is up when the bar comes or goes does not jump sideways.
          right: onTab ? TOAST_FAB_CLEARANCE : TOAST_GAP,
        },
        wrapStyle,
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.toast} accessibilityLiveRegion="polite">
        <Text style={styles.message} numberOfLines={2}>
          {toast.message}
        </Text>
        {toast.undo && (
          <Pressable
            onPress={async () => {
              // Ignore a second tap while this toast fades, which would run
              // the undo twice.
              if (fadingId.current === toast.id) return;
              const fn = toast.undo;
              fadeOut(toast.id);
              await fn?.();
            }}
            hitSlop={8}
            style={({ pressed }) => [
              styles.undoBtn,
              pressed && styles.undoBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Undo"
          >
            <Text style={styles.undoLabel}>Undo</Text>
            {/* The window, drawn draining. This is the difference between
                "there is an Undo" and "there is an Undo *and you have
                time*" — which is why the window is as long as
                it is. Anchored left so it shortens from the right. */}
            <Animated.View style={[styles.countdown, countdownStyle]} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

export function useUndoToast(): Ctx {
  const ctx = useContext(UndoToastContext);
  if (!ctx) return { show: () => {} };
  return ctx;
}

/**
 * The Undo button's width, fixed because the countdown has to scale about its
 * left edge and `transform-origin` doesn't exist in React Native — the bar is
 * translated out, scaled, and translated back, which needs a number.
 */
const UNDO_BTN_WIDTH = 76;

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: TOAST_GAP,
    alignItems: 'flex-start',
  },
  toast: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 8,
  },
  message: { color: '#f9fafb', fontSize: 14, maxWidth: 200, flexShrink: 1 },
  // A filled control rather than a text label. It used to be indigo words
  // beside white ones on a dark bar — legible, but reading as a caption at
  // exactly the moment it is the only way back from a deletion.
  undoBtn: {
    width: UNDO_BTN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#6366f1',
    overflow: 'hidden',
  },
  undoBtnPressed: { backgroundColor: '#4f46e5' },
  undoLabel: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  countdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
});
