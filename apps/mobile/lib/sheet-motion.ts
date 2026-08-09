/**
 * Motion policy for the task editor's bottom sheet.
 *
 * These live apart from the component for two reasons. The first is the one
 * `vitest.config.ts` is about: `apps/mobile` has no renderer, so the only way
 * to check a dismissal rule is to check it as arithmetic. The second is that
 * every function here is a **worklet** — the sheet's drag runs on the UI
 * thread, where it cannot call back into JS without giving up the frame budget
 * that put it there. The `'worklet'` directive is what lets Reanimated ship
 * these to that thread; under vitest (no babel plugin) it is an inert string
 * and they are ordinary functions.
 *
 * The sheet's position is a single number: `translateY`, in pixels, where 0 is
 * fully open and `sheetHeight` is fully dismissed. Everything visible — the
 * backdrop's dimming included — is derived from it, so there is exactly one
 * value in flight and no two animations to drift apart.
 */

/** Sheet height as a fraction of the window. Must match `styles.ghRoot.height`. */
export const SHEET_HEIGHT_RATIO = 0.92;

/** Open sweep. Long enough to read as a rise, short enough to feel answered. */
export const SHEET_OPEN_MS = 320;

/** The unhurried close, used when the sheet is dismissed without a flick. */
export const SHEET_CLOSE_MS = 240;

/** Floor on a velocity-matched close, so a hard flick still reads as motion. */
export const SHEET_CLOSE_MIN_MS = 110;

/** Backdrop dimming at rest. Reached only when the sheet is fully open. */
export const BACKDROP_OPACITY = 0.4;

/**
 * How far ahead a flick is projected, in seconds of coasting.
 *
 * A dismissal should answer where the finger was *going*, not where it
 * happened to be when it left the glass. 0.12s is the usual iOS-ish figure:
 * enough that a short fast flick from near the top commits, not so much that a
 * slow drag picks up phantom travel.
 */
export const VELOCITY_PROJECTION_S = 0.12;

/** Projected travel that commits to a dismissal, as a fraction of the sheet. */
export const DISMISS_TRAVEL_RATIO = 0.3;

/** Absolute floor for the same, so a short sheet still needs a real drag. */
export const DISMISS_TRAVEL_MIN_PX = 96;

/**
 * Upward velocity (px/s, negative) that always returns the sheet.
 *
 * Without this, a drag that goes deep and is then flicked back up would still
 * dismiss on distance alone — the user pulling the sheet back would be told no.
 */
export const RETURN_VELOCITY_PX_S = -350;

/**
 * Downward movement, in px, that turns a touch at the top of the body into a
 * drag of the sheet.
 *
 * Deliberately larger than Android's ~8px touch slop: the body's ScrollView
 * claims a drag at its slop, and the two thresholds racing is what `dragVerdict`
 * exists to keep out of the way of.
 */
export const SHEET_DRAG_ACTIVATE_PX = 12;

/**
 * What the sheet's dismiss gesture should do with a touch in progress.
 *
 * - `yield` — the body has somewhere to scroll, so the sheet must *fail* its
 *   gesture rather than merely sit still. A gesture that activates and then
 *   does nothing is worse than one that never activates: activating cancels the
 *   native ScrollView's touch stream, so the drag scrolls nothing and moves
 *   nothing. That is the "swiping down sometimes does nothing" bug — and it was
 *   intermittent because it was a race between the ScrollView's ~8px slop and
 *   this gesture's threshold, which a fast flick can clear in a single event.
 * - `activate` — the body is at its top and the finger has committed downward.
 * - `wait` — at the top, but not yet far enough to call it.
 */
export type DragVerdict = "yield" | "activate" | "wait";

export function dragVerdict(scrollOffset: number, dy: number): DragVerdict {
  "worklet";
  if (scrollOffset > 0) return "yield";
  return dy >= SHEET_DRAG_ACTIVATE_PX ? "activate" : "wait";
}

/** Spring for the return-to-open. Critically damped: settles, never bounces. */
export const RETURN_SPRING = {
  damping: 26,
  stiffness: 260,
  mass: 0.85,
  overshootClamping: true,
} as const;

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Where the sheet would come to rest if the finger let go now.
 *
 * Exported so the dismissal threshold can be reasoned about (and tested) in
 * the same units the gesture reports.
 */
export function projectedTranslation(
  translationY: number,
  velocityY: number
): number {
  "worklet";
  return translationY + velocityY * VELOCITY_PROJECTION_S;
}

/**
 * The sheet's position for a given raw drag.
 *
 * Upward drags clamp to 0 rather than being ignored. Ignoring them (the
 * `if (translationY > 0)` this replaces) strands the sheet: drag down 100px,
 * then back up past where you started, and the last value written was the
 * downward one — so the sheet sits below its resting position under a finger
 * that has already brought it home.
 */
export function dragTranslation(translationY: number): number {
  "worklet";
  return translationY > 0 ? translationY : 0;
}

/** Whether letting go here should dismiss the sheet rather than return it. */
export function shouldDismiss(
  translationY: number,
  velocityY: number,
  sheetHeight: number
): boolean {
  "worklet";
  if (velocityY <= RETURN_VELOCITY_PX_S) return false;
  const threshold = Math.max(
    sheetHeight * DISMISS_TRAVEL_RATIO,
    DISMISS_TRAVEL_MIN_PX
  );
  return projectedTranslation(translationY, velocityY) >= threshold;
}

/**
 * How long the closing sweep should take from where the drag left off.
 *
 * Two things it is not: a constant (a sheet flicked hard would decelerate the
 * moment the finger lifted, which reads as the gesture being taken away), and
 * pure velocity-matching (a drag ending at a crawl would take most of a
 * second). It matches the flick where the flick is faster, and caps at the
 * ordinary close otherwise.
 */
export function closeDurationMs(
  translationY: number,
  velocityY: number,
  sheetHeight: number
): number {
  "worklet";
  const remaining = Math.max(sheetHeight - translationY, 0);
  if (remaining <= 0) return 0;
  const byVelocity =
    velocityY > 0 ? (remaining / velocityY) * 1000 : SHEET_CLOSE_MS;
  return clamp(
    Math.min(byVelocity, SHEET_CLOSE_MS),
    SHEET_CLOSE_MIN_MS,
    SHEET_CLOSE_MS
  );
}

/**
 * Backdrop dimming for a given sheet position.
 *
 * Tied to the sheet rather than run as its own timing, which is what makes the
 * scrim track a *drag* — pull the sheet halfway down and the room behind it is
 * already half back. Two independent animations could only agree at the ends.
 */
export function backdropOpacity(
  translateY: number,
  sheetHeight: number
): number {
  "worklet";
  if (sheetHeight <= 0) return 0;
  return (1 - clamp(translateY / sheetHeight, 0, 1)) * BACKDROP_OPACITY;
}
