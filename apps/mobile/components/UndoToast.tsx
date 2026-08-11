import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { UNDO_TOAST_TTL_MS } from '@do-done/shared';

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

const FADE_MS = 150;

export function UndoToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  /**
   * 1 → 0 across the undo window, drawn as a bar under the button.
   *
   * The window is the only thing that makes the button useful, and the user
   * cannot see a `setTimeout`. Driving both from the same mount means the bar
   * and the timer that actually dismisses the toast can never disagree.
   */
  const countdown = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const fadeOut = useCallback(
    (after: () => void) => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(rise, {
          toValue: 1,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
      ]).start(after);
    },
    [opacity, rise]
  );

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    countdown.stopAnimation();
    fadeOut(() => setToast(null));
  }, [countdown, fadeOut]);

  const show = useCallback<Ctx['show']>(
    (t) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = ++idRef.current;
      setToast({ ...t, id });
      opacity.setValue(0);
      // Rises rather than appearing: it arrives while the row it is about is
      // still leaving, and two things fading in at once at opposite ends of the
      // screen read as one glitch rather than as cause and receipt.
      rise.setValue(1);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
        Animated.spring(rise, {
          toValue: 0,
          damping: 16,
          stiffness: 220,
          useNativeDriver: true,
        }),
      ]).start();
      // Linear, because this one is reporting a fact rather than expressing a
      // feeling: a window that appeared to slow down near the end would be
      // lying about how much of it is left.
      countdown.setValue(1);
      Animated.timing(countdown, {
        toValue: 0,
        duration: UNDO_TOAST_TTL_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
      timerRef.current = setTimeout(() => {
        fadeOut(() => setToast((cur) => (cur?.id === id ? null : cur)));
      }, UNDO_TOAST_TTL_MS);
    },
    [opacity, rise, countdown, fadeOut]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <UndoToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.wrap,
            {
              opacity,
              transform: [
                { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, 16] }) },
              ],
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.toast}>
            <Text style={styles.message} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.undo && (
              <Pressable
                onPress={async () => {
                  const fn = toast.undo;
                  dismiss();
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
                    time*" — which is the whole reason the window is as long as
                    it is. Anchored left so it shortens from the right. */}
                <Animated.View
                  style={[
                    styles.countdown,
                    {
                      transform: [
                        { translateX: -UNDO_BTN_WIDTH / 2 },
                        { scaleX: countdown },
                        { translateX: UNDO_BTN_WIDTH / 2 },
                      ],
                    },
                  ]}
                />
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}
    </UndoToastContext.Provider>
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
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  toast: {
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
  message: { color: '#f9fafb', fontSize: 14, maxWidth: 200 },
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
