/**
 * Which panel a `ReanimatedSwipeable` just opened.
 *
 * **`ReanimatedSwipeable` reports the direction of the gesture, not the side
 * whose panel opened** — the opposite of the older `Swipeable` it replaces,
 * and the opposite of what the prop name reads as. From the library's own
 * `dispatchImmediateEvents` (v2.31):
 *
 * ```ts
 * runOnJS(onSwipeableWillOpen)(
 *   toValue > 0 ? SwipeDirection.RIGHT : SwipeDirection.LEFT
 * );
 * ```
 *
 * `toValue > 0` is the row translated to the *right*, which is the row's
 * **left** actions showing. So `'right'` means the left panel opened, and
 * `'left'` means the right panel did.
 *
 * Reading it the other way round is silent and total: every swipe fires the
 * wrong action and the intended one never fires at all. Hence a named function
 * with a test rather than a string comparison inline.
 */
export type SwipeOpenDirection = 'left' | 'right';

/**
 * `'complete'` — the row's leading (left) panel, revealed by swiping right.
 * `'actions'` — the row's trailing (right) panel, revealed by swiping left.
 */
export type SwipePanel = 'complete' | 'actions';

export function panelForSwipe(direction: SwipeOpenDirection): SwipePanel {
  return direction === 'right' ? 'complete' : 'actions';
}

/**
 * The spring the row travels home on, handed to `ReanimatedSwipeable`'s
 * `animationOptions`.
 *
 * **The library's default is not a spring you can see.** It ships
 * `{ mass: 2, damping: 1000, stiffness: 700, overshootClamping: true }`, and
 * Reanimated has no overdamped solution — anything with a damping ratio at or
 * above 1 is integrated as *critically* damped, at `ω₀ = √(k/m)` ≈ 18.7 rad/s.
 * So a row released 96px out is back inside a couple of frames with no
 * deceleration to read, which is what makes the complete gesture feel like the
 * row is teleported home rather than let go of.
 *
 * This one is deliberately **under**damped (ζ ≈ 0.81): the row leaves the
 * finger, decelerates into its resting place, and settles. The overshoot that
 * buys is ~1.4% — a pixel and a bit at the widths this row swipes to — which is
 * the point. Past the row's own edge there is nothing but the list's
 * background, so a bounce big enough to *see* would read as a gap opening up
 * beside the row rather than as weight. What carries the physics is the curve,
 * not the rebound.
 *
 * `overshootClamping` has to be off for that: it halts the spring the instant it
 * crosses the target, which clips exactly the part of the curve this exists to
 * show.
 */
export const SWIPE_RETURN_SPRING = {
  mass: 1,
  stiffness: 260,
  damping: 26,
  overshootClamping: false,
  // Trim the invisible tail. The defaults (0.01px, 2px/s) keep the animation
  // nominally running long after the row has stopped moving, which delays the
  // library's own `onSwipeableClose`.
  restDisplacementThreshold: 0.25,
  restSpeedThreshold: 4,
};

/**
 * How long the completion waits after a swipe releases, so the row is home
 * before it is ticked off.
 *
 * The two used to happen at once: the check sprang, the halo rang out and the
 * strike-through drew themselves while the row was still 90px to the right and
 * travelling. The gesture had no sequence — the tick was already over by the
 * time the eye followed the row back, so the return read as a snap rather than
 * as the row being handed back.
 *
 * Matched to {@link SWIPE_RETURN_SPRING}: its envelope (`e^-ζω₀t`, ζω₀ ≈ 13/s)
 * is down to ~3% here, which is the frame the row visibly lands on. Later would
 * be a stall on the most repeated gesture in the app; earlier and the check is
 * back to competing with the travel. `swipe-actions.test.ts` derives it from
 * the spring rather than trusting the number.
 *
 * It is a delay in front of the completion, not an extension of it: everything
 * downstream — the 680ms exit envelope, the hold the write waits out, the undo
 * window — is untouched.
 */
export const SWIPE_RETURN_MS = 260;
