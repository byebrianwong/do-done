/**
 * The direction a `ReanimatedSwipeable` reports is the direction of the
 * *gesture*, not the panel that opened — the reverse of the old `Swipeable`,
 * and of what `onSwipeableWillOpen('left')` reads as.
 *
 * Getting it backwards has no symptom a type-checker or a crash reporter can
 * see: the row simply does the wrong thing on one gesture and nothing at all on
 * the other. It shipped that way — a left swipe, the gesture that opens Delete,
 * completed the task instead.
 */
import { describe, it, expect } from "vitest";
import { TASK_COMPLETE_EXIT_MS, UNDO_TOAST_TTL_MS } from "@do-done/shared";
import {
  SWIPE_RETURN_MS,
  SWIPE_RETURN_SPRING,
  panelForSwipe,
} from "./swipe-actions";

describe("panelForSwipe", () => {
  it("maps a rightward swipe to the leading complete action", () => {
    expect(panelForSwipe("right")).toBe("complete");
  });

  it("maps a leftward swipe to the trailing row actions", () => {
    // Today / Tomorrow / Delete. These are tapped, never fired by the swipe
    // itself, so this direction must not trigger anything on its own.
    expect(panelForSwipe("left")).toBe("actions");
  });
});

/**
 * The row's journey home, asserted as relationships rather than as numbers —
 * the same rule `completion-motion.test.ts` follows. Nothing here can be
 * checked on a device by eye either: "did the check start before the row
 * landed" is a question about two curves, and the answer is a few frames wide.
 */
describe("the swipe's return", () => {
  const { mass, stiffness, damping } = SWIPE_RETURN_SPRING;
  /** Undamped natural frequency, rad/s. */
  const omega0 = Math.sqrt(stiffness / mass);
  /** Damping ratio. Below 1 is a spring you can see; at or above it is a snap. */
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  /** The decay envelope a free response rides home on: `e^-ζω₀t`. */
  const remainingAt = (ms: number) => Math.exp(-zeta * omega0 * (ms / 1000));

  it("is underdamped, so the row decelerates into place", () => {
    // Reanimated has no overdamped branch: ζ ≥ 1 is integrated as critically
    // damped, which is the library default's ~19 rad/s snap this replaces.
    expect(zeta).toBeLessThan(1);
    // …but not so loose that the rebound opens a visible gap beside the row.
    // First overshoot, as a fraction of the distance travelled.
    const overshoot = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
    expect(overshoot).toBeLessThan(0.05);
  });

  it("does not clamp the overshoot away", () => {
    // Clamping halts the spring the frame it crosses zero, cutting off the
    // settle that is the whole point of choosing ζ < 1.
    expect(SWIPE_RETURN_SPRING.overshootClamping).toBe(false);
  });

  it("ticks the task off as the row lands, not while it travels", () => {
    // Home by any reading the eye takes: under 5% of the distance left.
    expect(remainingAt(SWIPE_RETURN_MS)).toBeLessThan(0.05);
    // And not a stall afterwards — a whole further envelope's worth of waiting
    // would be the gesture hesitating on the app's most repeated action.
    expect(remainingAt(SWIPE_RETURN_MS)).toBeGreaterThan(0.005);
  });

  it("delays the completion without extending it", () => {
    // The 680ms exit envelope, the hold the write waits out and the undo window
    // are all downstream of the tick, and none of them move. What has to hold is
    // that the whole sequence still fits inside the window that can undo it.
    expect(SWIPE_RETURN_MS + TASK_COMPLETE_EXIT_MS).toBeLessThan(
      UNDO_TOAST_TTL_MS
    );
  });
});
