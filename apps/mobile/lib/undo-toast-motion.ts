/**
 * Motion and placement rules for the undo toast (`components/UndoToast.tsx`).
 *
 * Pure so the node suite covers them: `apps/mobile` has no renderer.
 * `toastLift` is a worklet, read inside `useAnimatedStyle` on the UI thread.
 * Under vitest the `'worklet'` directive is an inert string.
 */

/** Fade in and fade out. */
export const TOAST_FADE_MS = 150;

/** How far below its resting place the toast starts its rise. */
export const TOAST_RISE_PX = 16;

/**
 * Where `rise` starts when a toast replaces one already on screen, as a share
 * of {@link TOAST_RISE_PX}.
 *
 * A replacement keeps full opacity, so the toast never leaves the screen. The
 * small dip is what says the text is a new receipt rather than the same one.
 */
export const TOAST_REPLACE_NUDGE = 0.35;

/** Gap between the toast and whatever is below it. Matches the add button's. */
export const TOAST_GAP = 16;

/**
 * Right inset on a tab screen: the add button's 16pt margin, its 56pt width,
 * and 12pt of space. Every tab screen has the add button in that corner, so a
 * toast centred across the full width would sit on top of it.
 */
export const TOAST_FAB_CLEARANCE = 16 + 56 + 12;

/**
 * How a `show()` starts its animation.
 *
 * - `enter`: nothing is mounted, so the toast fades in from 0 and rises the
 *   full distance.
 * - `replace`: a toast is mounted, including one halfway through fading out.
 *   The text changes in place, opacity goes back to 1 from wherever it is,
 *   and the toast dips by {@link TOAST_REPLACE_NUDGE} and springs back. It
 *   used to reset opacity to 0 first, which blinked the old toast out before
 *   the new one rose.
 * - `instant`: Reduce Motion. Land on the end state.
 */
export type ToastShowMode = 'enter' | 'replace' | 'instant';

export function toastShowMode(
  mounted: boolean,
  reduceMotion: boolean
): ToastShowMode {
  if (reduceMotion) return 'instant';
  return mounted ? 'replace' : 'enter';
}

/** The value `rise` (0 at rest, 1 fully lowered) is set to before it springs to 0. */
export function riseStart(mode: ToastShowMode): number {
  if (mode === 'enter') return 1;
  if (mode === 'replace') return TOAST_REPLACE_NUDGE;
  return 0;
}

/**
 * Whether a finished fade-out may unmount the toast.
 *
 * Two guards, and both are needed. A fade that was interrupted by a new
 * `show()` reports `finished: false`, and its toast is still the one on
 * screen. A fade can also report `finished: true` after a newer toast has
 * already been set, because the callback is scheduled back to the JS thread.
 * Unmounting on either would wipe a toast the user has not seen yet.
 */
export function shouldUnmountAfterFade(
  finished: boolean | undefined,
  fadedId: number,
  currentId: number | null
): boolean {
  return finished === true && currentId === fadedId;
}

/**
 * The toast's resting `bottom`: just above the safe area. Everything above
 * that is {@link toastLift}, a transform.
 */
export function toastBottom(insetBottom: number): number {
  return insetBottom + TOAST_GAP;
}

/**
 * How far the toast is raised above {@link toastBottom}, in pt.
 *
 * `onTab` runs 0 → 1 as a tab bar comes on screen, so moving between a tab
 * and a screen without one is a slide rather than a jump. `rowHeight` is the
 * bar's current row height, so on a tab the toast stays level with the add
 * button as the bar minimizes. Both are read on the UI thread.
 */
export function toastLift(onTab: number, rowHeight: number): number {
  'worklet';
  return onTab * rowHeight;
}

/**
 * Root-stack routes drawn *over* the tabs without hiding them. While one is on
 * top the tabs are not focused, but their bar is still on screen, so a toast
 * should stay where it is rather than drop onto the bar.
 */
const TRANSPARENT_OVER_TABS = new Set(['quick-add', 'task/[id]']);

/** Whether the tab bar is on screen, given the root stack's top route name. */
export function tabsShowing(topRoute: string | undefined): boolean {
  if (topRoute === undefined) return false;
  return topRoute === '(tabs)' || TRANSPARENT_OVER_TABS.has(topRoute);
}
