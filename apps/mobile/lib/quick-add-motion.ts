/**
 * Decisions behind how the quick-add composer opens and how its voice recorder
 * draws, kept pure so the node suite covers them. `apps/mobile` has no
 * renderer, so the components that use these cannot be tested themselves.
 */

/**
 * How long the widget's composer waits before it focuses the input or starts
 * recording.
 *
 * The widget's activity is still settling when its root first renders, and an
 * immediate focus there sometimes never brings the keyboard up. Recording
 * waits too: a permission dialog arriving with a window transition can leave
 * the composer behind a dialog it cannot be seen under.
 */
export const QUICK_ADD_SETTLE_DELAY_MS = 150;

export type QuickAddOpenAction =
  | { kind: 'none' }
  /** Focus while mounting, so the keyboard rises with the card. */
  | { kind: 'focus-on-mount' }
  | { kind: 'focus-later'; delayMs: number }
  | { kind: 'record-later'; delayMs: number };

/**
 * What the composer does when it mounts.
 *
 * `settled` is true when the host's window is already up, which is the in-app
 * modal: it opens inside the running app. There the input focuses while the
 * route fades in, so the keyboard and the card rise together. Before this the
 * route faded in, the composer waited 150ms, and then the card jumped up with
 * the keyboard: two steps.
 *
 * Recording always waits, on both hosts. Its delay is about the permission
 * dialog, which can still race the route's fade.
 */
export function quickAddOpenAction({
  autoFocus,
  autoRecord,
  settled,
}: {
  autoFocus: boolean;
  autoRecord: boolean;
  settled: boolean;
}): QuickAddOpenAction {
  if (autoRecord) return { kind: 'record-later', delayMs: QUICK_ADD_SETTLE_DELAY_MS };
  if (!autoFocus) return { kind: 'none' };
  if (settled) return { kind: 'focus-on-mount' };
  return { kind: 'focus-later', delayMs: QUICK_ADD_SETTLE_DELAY_MS };
}

/**
 * How long the composer's card takes to grow or shrink when a row inside it
 * appears or goes. Short, because it plays while the user is typing.
 */
export const QUICK_ADD_LAYOUT_MS = 160;

/** Bars in the voice recorder's level meter. Odd, so there is a centre one to peak. */
export const METER_BAR_COUNT = 9;

/** A bar's height when the meter is idle or the room is silent. */
export const METER_BAR_MIN = 4;

/** How far the centre bar rises above the minimum at full level. */
export const METER_BAR_RANGE = 26;

/**
 * How long the meter takes to reach a new level.
 *
 * It matches the interval the recogniser reports volume at
 * (`volumeChangeEventOptions.intervalMillis` in `voice-capture.ts`), so each
 * move finishes as the next reading arrives and the bars move continuously
 * instead of stepping.
 */
export const METER_TWEEN_MS = 150;

/**
 * A bar's height for an input level between 0 and 1.
 *
 * Bars away from the centre respond less. A row of identical bars moving
 * together reads as a progress indicator rather than as sound. Runs on the UI
 * thread, inside each bar's animated style.
 */
export function meterBarHeight(index: number, level: number): number {
  'worklet';
  const distance = Math.abs(index - (METER_BAR_COUNT - 1) / 2);
  const falloff = 1 - distance / METER_BAR_COUNT;
  const clamped = Math.min(1, Math.max(0, level));
  return METER_BAR_MIN + clamped * falloff * METER_BAR_RANGE;
}

/** Milliseconds since a recording started, never negative. */
export function recordingElapsed(startedAt: number, now: number): number {
  return Math.max(0, now - startedAt);
}
