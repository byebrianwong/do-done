/**
 * Motion policy for a tab bar press.
 *
 * **The press has its own clock.** A tap on a tab plays a ripple and a pop
 * that run to completion whatever the finger does next — lift it, hold it, or
 * slide it off the tab. That is the point: the bar is the one control that is
 * always on screen, and the finger is usually still covering the thing it just
 * hit, so the confirmation has to outlive the touch and it has to be visible
 * around the finger rather than under it.
 *
 * What it replaced said less. Android had the platform ripple, which is bound
 * to the press: hold the tab and it holds a flat wash, which reads as "you are
 * touching this" rather than "that landed". iOS had a dip in opacity, which is
 * gone the instant the finger is, and is exactly the frames a finger is
 * covering. Neither survived being watched from under a thumb.
 *
 * Lives apart from the component for the reasons `tab-bar-motion.ts` does:
 * `apps/mobile` has no renderer, so a curve can only be checked as arithmetic,
 * and the interpolations below are **worklets** read on the UI thread. Under
 * vitest the `'worklet'` directive is an inert string and they are ordinary
 * functions.
 */

/**
 * How long the ripple takes to run, start to gone.
 *
 * Long enough to still be going when a quick tap has ended — a 420ms run
 * against a tap that is over in about 80 — and short enough that it has
 * cleared before the destination screen has settled. Anything much longer
 * lands the ripple on top of the list it was supposed to reveal.
 */
export const TAB_RIPPLE_MS = 420;

/**
 * The fraction of that run spent arriving.
 *
 * Deliberately a small one. The ripple has to be *there* almost immediately,
 * or the press reads as laggy; what takes time is it spreading and clearing,
 * which is the part the eye follows. So it is a fast rise and a long fall,
 * not a symmetric pulse.
 */
export const TAB_RIPPLE_RISE = 0.16;

/** Peak alpha of the ripple. */
export const TAB_RIPPLE_OPACITY = 0.22;

/** Scale the ripple starts at, so it grows rather than simply appearing. */
export const TAB_RIPPLE_FROM_SCALE = 0.4;

/**
 * The ripple's diameter at full size, in px.
 *
 * Sized against the 26px icon rather than the tab's own width: the icon is
 * what the tap chose, and a disc that spread to the full quarter-screen target
 * would read as a flash of the whole bar. The row clips it top and bottom,
 * which is what Material's own bounded ripple does and is why it still reads
 * as a ripple when the bar is minimized to 30pt.
 */
export const TAB_RIPPLE_SIZE = 40;

/** How far the icon dips under the press, before it springs back. */
export const TAB_PRESS_DIP_SCALE = 0.86;

/** How long the dip takes. Fast — this is the flinch, not the animation. */
export const TAB_PRESS_DIP_MS = 90;

/**
 * The spring that brings the icon back.
 *
 * Underdamped on purpose (ζ ≈ 0.54), unlike `TAB_BAR_SPRING` next door. That
 * one is chrome reacting to a scroll the user is already doing, so it settles
 * without announcing itself. This one *is* the announcement: the ~13%
 * overshoot past 1 is what makes a press read as a pop rather than as the icon
 * sagging and recovering. Much below that damping it wobbles, and a tab icon
 * that wobbles is the bar drawing attention to itself between two screens.
 */
export const TAB_PRESS_SPRING = {
  damping: 14,
  stiffness: 340,
  mass: 0.5,
} as const;

function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The ripple's alpha at a point in its run (0 pressed → 1 finished).
 *
 * Rises to {@link TAB_RIPPLE_OPACITY} over {@link TAB_RIPPLE_RISE} of the run,
 * then falls to nothing across the rest. Both ends are exactly 0, so a value
 * parked at either resting point draws nothing at all — which is what lets one
 * shared value per tab sit at 1 between presses instead of needing to be
 * unwound.
 */
export function rippleOpacity(progress: number): number {
  'worklet';
  const t = clamp01(progress);
  if (t <= TAB_RIPPLE_RISE) {
    return TAB_RIPPLE_OPACITY * (t / TAB_RIPPLE_RISE);
  }
  return TAB_RIPPLE_OPACITY * (1 - (t - TAB_RIPPLE_RISE) / (1 - TAB_RIPPLE_RISE));
}

/**
 * The ripple's scale across that same run.
 *
 * Keeps growing after the alpha has peaked, so what the eye follows is a ring
 * spreading outward and thinning, rather than a disc that inflates and then
 * blinks out at full size.
 */
export function rippleScale(progress: number): number {
  'worklet';
  const t = clamp01(progress);
  return TAB_RIPPLE_FROM_SCALE + (1 - TAB_RIPPLE_FROM_SCALE) * t;
}

/**
 * The icon's scale, combining the bar's minimize with the press pop.
 *
 * Multiplied rather than picked between, because the two are genuinely
 * concurrent: a tab can be pressed while the bar is part-way through
 * minimizing, and either factor alone would snap the icon to the other's
 * resting size for the length of the press.
 */
export function pressedIconScale(minimized: number, pop: number): number {
  'worklet';
  return minimized * pop;
}
