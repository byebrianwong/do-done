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
import { panelForSwipe } from "./swipe-actions";

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
