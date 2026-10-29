/**
 * The app's bottom sheet: menus, pickers and option lists.
 *
 * It rises from the bottom edge as the backdrop darkens, and leaves the same
 * way. Before this, the sheets behaved three different ways and none of them
 * did that: most faded in place (`animationType="fade"`), the Display sheet
 * slid the dark backdrop up the screen with it (`"slide"`), and several were
 * removed from the tree while their `Modal` was still visible, so they
 * vanished in one frame.
 *
 * - **It is still an RN `Modal`**, with `animationType="none"`. The `Modal` is
 *   what puts a picker above the task editor, which is itself a `Modal`, and
 *   above every screen. The motion is ours: one shared value, `translateY`, in
 *   pixels below the resting place, animated on the UI thread. The backdrop's
 *   opacity is derived from it (`backdropOpacity`), so a drag on the grabber
 *   dims and lightens the room with the finger.
 * - **It stays mounted until its exit finishes.** `visible` going false starts
 *   the slide down; the children unmount when it lands. So a caller can pass
 *   `visible={open}` and let this decide when the content goes, and the body of
 *   a closed sheet still costs nothing: nothing inside renders until the sheet
 *   opens. Put an expensive body in its own component so its function does not
 *   run while the sheet is closed.
 * - **The bottom padding includes the safe-area inset.** See
 *   `sheetBottomPadding`: a `Modal` window is edge-to-edge here, so a fixed
 *   28px left the last row under three-button navigation.
 * - **Android back closes it** (`onRequestClose`), and **Reduce Motion lands on
 *   the end state**: open is open, closed is gone, with nothing in between.
 * - **The grabber drags.** Only the grabber, not the whole sheet: several
 *   sheets hold a `ScrollView`, and sharing a drag with one is the problem the
 *   task editor's `dragVerdict` exists to solve. A strip at the top avoids it.
 *
 * A row that opens *another* modal from here must wait for this one to go on
 * iOS. Use `useRunAfterDismiss` and pass its `onDismiss` through.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  afterDismissMode,
  exitDurationMs,
  sheetBottomPadding,
} from '@/lib/bottom-sheet';
import {
  RETURN_SPRING,
  SHEET_OPEN_MS,
  backdropOpacity,
  dragTranslation,
  shouldDismiss,
} from '@/lib/sheet-motion';
import { prefersReducedMotion } from '@/lib/use-row-exit';

/** Where the sheet waits before its first layout: far below any screen. */
const OFFSCREEN = 4000;

interface Props {
  visible: boolean;
  /** Backdrop tap, Android back, and a drag past the release threshold. */
  onClose: () => void;
  /**
   * The native dismissal, iOS only. Pass `useRunAfterDismiss().onDismiss` when
   * a row opens another modal.
   */
  onDismiss?: () => void;
  /**
   * The sheet is fully gone: after the native dismissal on iOS, after the exit
   * on Android. For work that needs the window back, like focusing a field
   * behind the sheet so its keyboard can rise.
   */
  onClosed?: () => void;
  /** Merged onto the sheet: horizontal padding, a max height, and so on. */
  style?: StyleProp<ViewStyle>;
  /** Read by a screen reader for the backdrop's close button. */
  closeLabel?: string;
  children: React.ReactNode;
}

/**
 * The rise, the exit and the backdrop, for any bottom sheet.
 *
 * `BottomSheet` uses it inside a `Modal`; `ProjectFormSheet` uses it in an
 * overlay at the app root, which cannot be a `Modal` (see that file). Spread
 * `onLayout` and `sheetStyle` onto the sheet and `backdropStyle` onto an
 * opaque backdrop.
 *
 * The sheet waits off screen until its first layout, because only then is the
 * distance known, and rises from there. `visible` going false slides it down
 * by its own height, and `onExited` fires when it lands. Re-opening mid-exit
 * turns it around where it is. Reduce Motion skips both animations.
 *
 * `extraExitTravel` is for a sheet whose bottom edge is not the screen's: the
 * project form sits on the keyboard, and the keyboard leaves at the same time
 * as the sheet does. Sliding by its own height alone would leave its top edge
 * showing above the retreating keyboard.
 */
export function useSheetMotion(
  visible: boolean,
  onExited: () => void,
  extraExitTravel?: () => number
) {
  const translateY = useSharedValue(OFFSCREEN);
  const sheetHeight = useSharedValue(0);
  // JS-side state the effects branch on. Refs, not shared values, because
  // nothing on the UI thread reads them.
  const measured = useRef(false);
  // True from the moment the sheet is shown until its exit has landed.
  const live = useRef(visible);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // A drag that released past the threshold hands its speed to the exit.
  const releaseVelocity = useRef(0);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const extraRef = useRef(extraExitTravel);
  extraRef.current = extraExitTravel;

  const rise = useCallback(() => {
    if (prefersReducedMotion()) {
      translateY.value = 0;
      return;
    }
    translateY.value = withTiming(0, {
      duration: SHEET_OPEN_MS,
      // Fast off the mark and easing into place, like the task editor.
      easing: Easing.out(Easing.cubic),
    });
  }, [translateY]);

  const finishExit = useCallback(() => {
    // Re-opened while it was leaving: the rise took over already.
    if (visibleRef.current || !live.current) return;
    live.current = false;
    measured.current = false;
    translateY.value = OFFSCREEN;
    onExitedRef.current();
  }, [translateY]);

  useEffect(() => {
    if (visible) {
      live.current = true;
      // Re-opened mid-exit. The content is still laid out, so there is no
      // onLayout coming to start the rise.
      if (measured.current) rise();
      return;
    }
    // Already closed: the first render of a sheet that starts hidden.
    if (!live.current) return;
    const velocity = releaseVelocity.current;
    releaseVelocity.current = 0;
    if (!measured.current || prefersReducedMotion()) {
      finishExit();
      return;
    }
    const h = sheetHeight.value;
    translateY.value = withTiming(
      h + Math.max(extraRef.current?.() ?? 0, 0),
      {
        duration: exitDurationMs(translateY.value, velocity, h),
        // A flick keeps its speed; a plain close accelerates away.
        easing: velocity > 0 ? Easing.out(Easing.quad) : Easing.in(Easing.cubic),
      },
      (done) => {
        'worklet';
        if (done) runOnJS(finishExit)();
      }
    );
    // Only `visible` drives this; the rest are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      sheetHeight.value = h;
      // Later layouts (a sheet growing a form, a keyboard shrinking it) only
      // update the height.
      if (measured.current) return;
      measured.current = true;
      if (!visibleRef.current) return;
      translateY.value = h;
      rise();
    },
    [sheetHeight, translateY, rise]
  );

  /** Record a drag's release speed, just before closing the sheet. */
  const releaseWith = useCallback((velocityY: number) => {
    releaseVelocity.current = velocityY;
  }, []);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity(translateY.value, sheetHeight.value),
  }));

  return { translateY, sheetHeight, onLayout, releaseWith, sheetStyle, backdropStyle };
}

export function BottomSheet({
  visible,
  onClose,
  onDismiss,
  onClosed,
  style,
  closeLabel = 'Close',
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  const onExited = useCallback(() => {
    setMounted(false);
    // iOS reports this from the native dismissal instead, which comes after.
    if (Platform.OS !== 'ios') onClosedRef.current?.();
  }, []);

  const { translateY, sheetHeight, onLayout, releaseWith, sheetStyle, backdropStyle } =
    useSheetMotion(visible, onExited);

  const handleDismiss = useCallback(() => {
    onDismiss?.();
    onClosedRef.current?.();
  }, [onDismiss]);

  const dragDismiss = useCallback(
    (velocityY: number) => {
      releaseWith(velocityY);
      onClose();
    },
    [releaseWith, onClose]
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(6)
        .failOffsetX([-24, 24])
        .onUpdate((e) => {
          'worklet';
          translateY.value = dragTranslation(e.translationY);
        })
        .onEnd((e, success) => {
          'worklet';
          if (success && shouldDismiss(e.translationY, e.velocityY, sheetHeight.value)) {
            runOnJS(dragDismiss)(e.velocityY);
          } else {
            translateY.value = withSpring(0, RETURN_SPRING);
          }
        }),
    [translateY, sheetHeight, dragDismiss]
  );

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={handleDismiss}
    >
      {mounted ? (
        <GestureHandlerRootView
          // The top padding keeps a tall sheet below the status bar; the
          // sheet shrinks to fit rather than running off the top.
          style={[styles.root, { paddingTop: insets.top + 12 }]}
        >
          <Reanimated.View
            pointerEvents="none"
            style={[styles.backdrop, backdropStyle]}
          />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            disabled={!visible}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
          />
          <Reanimated.View
            onLayout={onLayout}
            // A sheet on its way out takes no more taps.
            pointerEvents={visible ? 'auto' : 'none'}
            accessibilityViewIsModal
            style={[
              styles.sheet,
              style,
              { paddingBottom: sheetBottomPadding(insets.bottom) },
              sheetStyle,
            ]}
          >
            <GestureDetector gesture={pan}>
              <View style={styles.grabberWrap}>
                <View style={styles.grabber} />
              </View>
            </GestureDetector>
            {children}
          </Reanimated.View>
        </GestureHandlerRootView>
      ) : null}
    </Modal>
  );
}

/**
 * Hold a row's follow-up until the sheet it was tapped in has gone.
 *
 * On iOS a `Modal` presented while another is still dismissing never appears,
 * and nothing reports it. So `runAfterDismiss(fn)` keeps `fn` until the
 * sheet's native `onDismiss`, which fires once its exit has finished. Android
 * has no such problem and no `onDismiss` either, so there `fn` runs at once.
 *
 * Call it in the same handler that closes the sheet, and pass `onDismiss` to
 * the `BottomSheet`. Nothing is queued when the sheet closes by its backdrop,
 * so `onDismiss` is a no-op then.
 */
export function useRunAfterDismiss() {
  const pending = useRef<(() => void) | null>(null);

  const runAfterDismiss = useCallback((fn: () => void) => {
    if (afterDismissMode(Platform.OS) === 'after-dismiss') pending.current = fn;
    else fn();
  }, []);

  const onDismiss = useCallback(() => {
    const run = pending.current;
    pending.current = null;
    run?.();
  }, []);

  return { runAfterDismiss, onDismiss };
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    // Opaque: the dimming is `backdropOpacity`. An alpha here would multiply.
    backgroundColor: '#111827',
  },
  sheet: {
    flexShrink: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  // Tall enough to land a thumb on, though the bar drawn in it is small.
  grabberWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 8 },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
  },
});
