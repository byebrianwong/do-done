/**
 * Motion policy for the bottom tab bar's minimize-on-scroll.
 *
 * The bar **shrinks; it never hides.** Scrolling down drops the labels and
 * takes the icon row from {@link TAB_BAR_ROW_HEIGHT} to
 * {@link TAB_BAR_MINIMIZED_ROW_HEIGHT}; scrolling up puts them back. All five
 * destinations stay tappable the whole time, which is the difference between
 * this and an auto-hiding bar: the reason to keep chrome at the bottom of a
 * task list is that switching views is a common next action, and a switcher
 * you have to scroll back up to reach has been taken away, not tidied.
 *
 * This lives apart from the components for the two reasons `sheet-motion.ts`
 * does. `apps/mobile` has no renderer, so the only way to check a threshold is
 * to check it as arithmetic — {@link nextMinimizeState} is the whole decision
 * and is an ordinary pure function over a plain state object. And the
 * interpolations below are **worklets**: they are read inside
 * `useAnimatedStyle` on the UI thread, where the scroll is happening. Under
 * vitest (no babel plugin) the `'worklet'` directive is an inert string and
 * they are ordinary functions.
 */

/** Height of the icon+label row when the bar is expanded, above the safe area. */
export const TAB_BAR_ROW_HEIGHT = 50;

/**
 * The same row minimized: icon only.
 *
 * The 20px difference is the whole prize, and it is worth being honest about
 * it: a task row is 42-58px, so this buys about a third of one. What the bar
 * also sheds is visual weight — five labels and 40% of its height — which is
 * most of why the pattern reads as roomier than the pixel count suggests.
 *
 * It is deliberately **not** larger. The obvious way to double it is to shave
 * the bottom safe-area inset as well, which is what iOS 26's own minimized bar
 * does. That would put the icons' bottom edge within a few points of the home
 * indicator's gesture zone, where the system eats the first upward swipe. A
 * tap target is not worth 14 pixels.
 */
export const TAB_BAR_MINIMIZED_ROW_HEIGHT = 30;

/** Icon size handed to each screen's `tabBarIcon`, at rest. */
export const TAB_ICON_SIZE = 26;

/** What that icon scales to when minimized. Transform, never a font size. */
export const TAB_ICON_MINIMIZED_SCALE = 0.8;

/**
 * Progress at which the labels have finished fading.
 *
 * Earlier than the height finishes shrinking, on purpose: the row clips its
 * content, so a label still at partial opacity when the clip reaches it would
 * be cut in half rather than faded out.
 */
export const TAB_LABEL_FADE_END = 0.5;

/**
 * Downward travel, in px, that minimizes the bar.
 *
 * Roughly half a task row. A momentum scroll changes direction constantly —
 * every flick ends in a bounce, and a list settling after a drop moves a few
 * pixels either way — so a bar driven straight off the sign of the delta
 * flickers. This is the hysteresis that stops it.
 */
export const MINIMIZE_TRAVEL_PX = 24;

/**
 * Upward travel that brings it back, deliberately *half* the above.
 *
 * The two failure modes are not symmetrical. A bar that minimized a little too
 * eagerly costs a glance; a bar that will not come back is the user pulling at
 * their own navigation and being told no. So getting it back is always the
 * easier of the two gestures.
 */
export const EXPAND_TRAVEL_PX = 12;

/** Within this of the top, the bar is always expanded, whatever the travel says. */
export const EXPAND_AT_TOP_PX = 8;

/**
 * The furthest a list can actually be scrolled, or null while unknown.
 *
 * Needed because both ends of a list bounce, and neither bounce is a gesture.
 * The top one is easy — it reads as a negative offset. The bottom one is not:
 * flick to the end and the list overshoots by ten or fifteen points and
 * settles back, which arrives here as a clean run of *decreasing* offsets and
 * is indistinguishable from a small upward scroll. It sits right on
 * {@link EXPAND_TRAVEL_PX}, so reaching the end of a list popped the bar open
 * again about half the time — the worst kind of behaviour to ship, because it
 * looks like a glitch rather than a rule.
 *
 * Returns null when either measurement is missing, which means "don't clamp":
 * a list reports its content size a frame or two after it first lays out, and
 * refusing to react until then would eat the start of the first scroll.
 */
export function maxScrollOffset(
  contentHeight: number | null,
  viewportHeight: number | null
): number | null {
  if (contentHeight === null || viewportHeight === null) return null;
  const max = contentHeight - viewportHeight;
  return max > 0 ? max : 0;
}

/**
 * The offset with both rubber bands taken out of it.
 *
 * Over-scroll is the list showing you that there is nothing more, not you
 * asking for something — so at either end it reports as "no travel" and the
 * bar holds whatever it was doing.
 */
export function clampToScrollRange(
  offset: number,
  maxOffset: number | null
): number {
  const y = offset > 0 ? offset : 0;
  if (maxOffset === null) return y;
  return y < maxOffset ? y : maxOffset;
}

/**
 * The sweep between the two states.
 *
 * Critically damped: the bar is chrome reacting to something the user is
 * already doing, so it should settle rather than announce itself. A bounce
 * here would draw the eye to the navigation at the exact moment the user is
 * reading their tasks.
 */
export const TAB_BAR_SPRING = {
  damping: 22,
  stiffness: 220,
  mass: 0.6,
  overshootClamping: true,
} as const;

/**
 * What the bar is doing, and where the current run of travel began.
 *
 * `anchor` is the last turning point, not the last offset: a reversal has to
 * be measured from where the finger changed its mind, or every threshold would
 * be measured from one frame ago and cleared by any flick.
 */
export interface MinimizeState {
  minimized: boolean;
  anchor: number;
}

/** A list that has not been scrolled yet. */
export const MINIMIZE_AT_REST: MinimizeState = { minimized: false, anchor: 0 };

/**
 * The bar's state after a scroll to `offset`.
 *
 * Called once per scroll frame on the JS thread, and returns the *same object*
 * when nothing changed, so the caller can compare by `minimized` and touch the
 * shared value only on an actual flip. Nothing here animates; it decides.
 *
 * `canMinimize` is the one veto, and it is a veto in one direction only —
 * false can keep the bar out, never trap it in. That matters because its
 * callers are things that can get stuck: a drag in progress, a Reduce Motion
 * setting read asynchronously at launch. The worst a stuck `false` can do is
 * leave the bar permanently expanded, which is the app as it was before this
 * existed.
 *
 * There is no "is the list long enough to scroll" input, because the threshold
 * already answers it: minimizing needs {@link MINIMIZE_TRAVEL_PX} of travel
 * past {@link EXPAND_AT_TOP_PX}, so a list with less scroll range than that
 * cannot reach the state at all.
 *
 * `maxOffset` is the list's scroll range, or null while it is still unknown —
 * see {@link clampToScrollRange}.
 */
export function nextMinimizeState(
  state: MinimizeState,
  offset: number,
  canMinimize: boolean,
  maxOffset: number | null = null
): MinimizeState {
  const y = clampToScrollRange(offset, maxOffset);

  if (y <= EXPAND_AT_TOP_PX) {
    if (!state.minimized && state.anchor === y) return state;
    return { minimized: false, anchor: y };
  }

  const dy = y - state.anchor;
  if (dy === 0) return state;

  if (dy > 0) {
    // Travelling down. Once minimized, the anchor tracks the leading edge, so
    // the upward threshold below is measured from the moment of reversal.
    if (state.minimized) return { minimized: true, anchor: y };
    if (!canMinimize) return { minimized: false, anchor: y };
    return dy >= MINIMIZE_TRAVEL_PX ? { minimized: true, anchor: y } : state;
  }

  // Travelling up. Same rule mirrored: an expanded bar tracks, a minimized one
  // accumulates until it has seen enough to come back.
  if (!state.minimized) return { minimized: false, anchor: y };
  return -dy >= EXPAND_TRAVEL_PX ? { minimized: false, anchor: y } : state;
}

function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(from: number, to: number, t: number): number {
  'worklet';
  return from + (to - from) * t;
}

/** The icon row's height for a given progress (0 expanded → 1 minimized). */
export function tabRowHeight(progress: number): number {
  'worklet';
  return lerp(
    TAB_BAR_ROW_HEIGHT,
    TAB_BAR_MINIMIZED_ROW_HEIGHT,
    clamp01(progress)
  );
}

/**
 * The bar's full height, safe area included.
 *
 * The inset is *not* interpolated — see {@link TAB_BAR_MINIMIZED_ROW_HEIGHT}.
 * Exported because two other things have to agree with it: the floating add
 * button, which keeps its gap above the bar, and each list's bottom padding,
 * which has to let the last row scroll clear of it.
 */
export function tabBarHeight(progress: number, bottomInset: number): number {
  'worklet';
  return bottomInset + tabRowHeight(progress);
}

/** Label opacity, gone before the shrinking row can clip it. */
export function tabLabelOpacity(progress: number): number {
  'worklet';
  return 1 - clamp01(progress / TAB_LABEL_FADE_END);
}

/** Icon scale. A transform, so no text re-measures during the sweep. */
export function tabIconScale(progress: number): number {
  'worklet';
  return lerp(1, TAB_ICON_MINIMIZED_SCALE, clamp01(progress));
}
