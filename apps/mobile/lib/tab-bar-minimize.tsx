/**
 * The one shared value behind the minimizing tab bar, and the hooks that feed
 * and read it.
 *
 * `progress` is 0 when the bar is expanded and 1 when it is minimized, and it
 * is the *only* thing in flight: the bar's height, its labels' opacity, its
 * icons' scale and the add button's resting place are all derived from it on
 * the UI thread. Two independent animations could only ever agree at the ends,
 * which on a scroll-driven change is most of the time they are visible.
 *
 * **The decision runs on the JS thread; the motion does not.**
 * `react-native-draggable-flatlist` owns its list's `onScroll` — it overrides
 * whatever you pass and drives its own auto-scroll from it — so the only way
 * in is `onScrollOffsetChange`, which the library already hops to JS on every
 * frame whether or not anything is listening. What that hop costs us is one
 * call to `nextMinimizeState`, which is arithmetic over two numbers and, on
 * all but two frames of a scroll, returns its own argument. The shared value is
 * written only on an actual flip, so the spring starts once per direction
 * change rather than once per frame.
 *
 * A screen outside the tab navigator — a pushed project, the launcher's widget
 * root — has no provider above it. Every hook here answers for that: the list
 * sync becomes inert and the add button falls back to the corner it already
 * sat in.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';
import { AccessibilityInfo, type LayoutChangeEvent } from 'react-native';
import {
  type SharedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { prefersReducedMotion } from './use-row-exit';
import {
  MINIMIZE_AT_REST,
  TAB_BAR_ROW_HEIGHT,
  TAB_BAR_SPRING,
  maxScrollOffset,
  nextMinimizeState,
  type MinimizeState,
} from './tab-bar-motion';

/**
 * Screen-reader state, cached the way `use-row-exit.ts` caches reduce-motion
 * and for the same reason: the answer is needed inside a scroll frame, where
 * an `await` would cost the frame.
 */
let screenReader = false;
void AccessibilityInfo.isScreenReaderEnabled().then((v) => {
  screenReader = v;
});
AccessibilityInfo.addEventListener('screenReaderChanged', (v) => {
  screenReader = v;
});

/**
 * Whether the bar is allowed to minimize at all.
 *
 * Two settings turn it off outright rather than making it play differently:
 *
 * - **Reduce Motion.** Elsewhere in the app that setting lands on the end
 *   state and drops the decorative layers, because the end state is the thing
 *   that happened — a task really is done and its row really is gone. Nothing
 *   happened here. The minimize *is* the decoration, so the right reading of
 *   "reduce motion" is not to jump-cut the bar between two sizes on every
 *   flick, it is to leave the bar alone.
 * - **A screen reader.** VoiceOver and TalkBack move focus and scroll the list
 *   themselves, so the bar would resize under an exploring finger in response
 *   to gestures the user did not make with the list in mind.
 */
function chromeMayMinimize(): boolean {
  return !prefersReducedMotion() && !screenReader;
}

export interface TabBarMinimize {
  /** 0 expanded → 1 minimized. Read on the UI thread, written only on a flip. */
  progress: SharedValue<number>;
  /**
   * Feed it a list's scroll offset, and that list's scroll range if it knows
   * it yet — see `clampToScrollRange`. The range belongs to the list rather
   * than to this controller because all five tab screens are mounted at once
   * and each has its own.
   */
  onScrollOffset: (offset: number, maxOffset: number | null) => void;
  /**
   * Hold the bar still while a row is being dragged.
   *
   * A drag near the bottom of the screen auto-scrolls the list, which is the
   * list moving because the *library* is moving it. Letting that minimize the
   * bar means dropping a row leaves the navigation in a state the user never
   * asked for, and it happens under the finger that is placing the row.
   */
  setDragging: (dragging: boolean) => void;
  /** Put the bar back, and forget where the last scroll run started. */
  expand: () => void;
}

const Ctx = createContext<TabBarMinimize | null>(null);

export function TabBarMinimizeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const progress = useSharedValue(0);
  const stateRef = useRef<MinimizeState>(MINIMIZE_AT_REST);
  const draggingRef = useRef(false);

  const onScrollOffset = useCallback(
    (offset: number, maxOffset: number | null) => {
      const prev = stateRef.current;
      const next = nextMinimizeState(
        prev,
        offset,
        !draggingRef.current && chromeMayMinimize(),
        maxOffset
      );
      // The common frame: travel is still accumulating and nothing moved.
      if (next === prev) return;
      stateRef.current = next;
      if (next.minimized === prev.minimized) return;
      progress.value = withSpring(next.minimized ? 1 : 0, TAB_BAR_SPRING);
    },
    [progress]
  );

  const setDragging = useCallback((dragging: boolean) => {
    draggingRef.current = dragging;
  }, []);

  const expand = useCallback(() => {
    const wasMinimized = stateRef.current.minimized;
    // Reset the anchor as well as the state: whatever list comes next has its
    // own scroll offset, and measuring travel against the old one would read
    // the change of screen as a gesture.
    stateRef.current = MINIMIZE_AT_REST;
    if (wasMinimized) progress.value = withSpring(0, TAB_BAR_SPRING);
  }, [progress]);

  const value = useMemo<TabBarMinimize>(
    () => ({ progress, onScrollOffset, setDragging, expand }),
    [progress, onScrollOffset, setDragging, expand]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The controller, or null on a screen with no tab bar under it. */
export function useTabBarMinimize(): TabBarMinimize | null {
  return useContext(Ctx);
}

/**
 * What a scrolling list needs to drive the bar, inert where there isn't one.
 *
 * `contentInset` is the *expanded* bar's height and never varies with
 * progress. The bar floats over the screen (see `MinimizingTabBar`), so a list
 * runs to the bottom edge and has to reserve that much padding for its last
 * row to be scrollable clear of it. Varying it would relayout the list on
 * every frame of the sweep, which is the whole thing the floating bar exists
 * to avoid.
 */
export function useTabBarScrollSync(): {
  onScrollOffsetChange: ((offset: number) => void) | undefined;
  /** Both of these exist only to learn the list's scroll range. */
  onContentSizeChange: ((width: number, height: number) => void) | undefined;
  onListLayout: ((event: LayoutChangeEvent) => void) | undefined;
  setDragging: (dragging: boolean) => void;
  contentInset: number;
} {
  const ctx = useTabBarMinimize();
  const insets = useSafeAreaInsets();
  // Per list, not per provider: every tab screen is mounted at once, and an
  // unfocused one reporting its own geometry would answer for the focused one.
  const contentHeight = useRef<number | null>(null);
  const viewportHeight = useRef<number | null>(null);
  const noop = useCallback(() => {}, []);

  const onScrollOffsetChange = useCallback(
    (offset: number) => {
      ctx?.onScrollOffset(
        offset,
        maxScrollOffset(contentHeight.current, viewportHeight.current)
      );
    },
    [ctx]
  );

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeight.current = height;
  }, []);

  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    viewportHeight.current = event.nativeEvent.layout.height;
  }, []);

  return {
    onScrollOffsetChange: ctx ? onScrollOffsetChange : undefined,
    onContentSizeChange: ctx ? onContentSizeChange : undefined,
    onListLayout: ctx ? onListLayout : undefined,
    setDragging: ctx?.setDragging ?? noop,
    contentInset: ctx ? insets.bottom + TAB_BAR_ROW_HEIGHT : 0,
  };
}
