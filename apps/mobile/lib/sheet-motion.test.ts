import { describe, expect, it } from "vitest";

import {
  BACKDROP_OPACITY,
  DISMISS_TRAVEL_MIN_PX,
  SHEET_CLOSE_MIN_MS,
  SHEET_CLOSE_MS,
  SHEET_DRAG_ACTIVATE_PX,
  backdropOpacity,
  closeDurationMs,
  dragTranslation,
  dragVerdict,
  projectedTranslation,
  shouldDismiss,
} from "./sheet-motion";

/** A typical phone sheet: 92% of an 800pt window. */
const H = 736;

describe("dragTranslation", () => {
  it("passes a downward drag through unchanged", () => {
    expect(dragTranslation(0)).toBe(0);
    expect(dragTranslation(140.5)).toBe(140.5);
  });

  it("clamps an upward drag to the resting position", () => {
    // The bug this replaces: an ignored upward drag left the last *downward*
    // value on screen, so pulling the sheet back up stranded it below its rest.
    expect(dragTranslation(-200)).toBe(0);
  });
});

describe("dragVerdict", () => {
  it("yields the drag whenever the body has somewhere to scroll", () => {
    // The bug this exists for: standing still while activated is not standing
    // down. An active handler cancels the ScrollView underneath it, so the
    // drag scrolled nothing and moved nothing.
    expect(dragVerdict(1, 0)).toBe("yield");
    expect(dragVerdict(240, 200)).toBe("yield");
  });

  it("yields on a scroll that starts at the top and then reverses", () => {
    // Touch down at 0, flick the body up, come back down past the start: the
    // claim taken at touch-down must not survive the body having scrolled.
    expect(dragVerdict(0, 4)).toBe("wait");
    expect(dragVerdict(180, 40)).toBe("yield");
  });

  it("waits at the top until the finger has committed downward", () => {
    expect(dragVerdict(0, 0)).toBe("wait");
    expect(dragVerdict(0, SHEET_DRAG_ACTIVATE_PX - 1)).toBe("wait");
  });

  it("never activates on an upward drag, which is a scroll", () => {
    expect(dragVerdict(0, -60)).toBe("wait");
  });

  it("activates at the top once the threshold is cleared", () => {
    expect(dragVerdict(0, SHEET_DRAG_ACTIVATE_PX)).toBe("activate");
    expect(dragVerdict(0, 400)).toBe("activate");
  });

  it("treats an overscrolled body as being at its top", () => {
    // iOS bounce puts the offset negative; that is still nothing left to
    // scroll upward, so the sheet may take the drag.
    expect(dragVerdict(-30, SHEET_DRAG_ACTIVATE_PX)).toBe("activate");
  });

  it("clears the threshold in one event, which is the race that was lost", () => {
    // A fast flick's first move can jump well past both this threshold and
    // Android's ~8px scroll slop. At the top that is a dismissal; mid-list it
    // must be the body's, whatever the distance.
    expect(dragVerdict(0, 90)).toBe("activate");
    expect(dragVerdict(2, 90)).toBe("yield");
  });
});

describe("shouldDismiss", () => {
  it("returns the sheet on a small, slow drag", () => {
    expect(shouldDismiss(40, 0, H)).toBe(false);
  });

  it("dismisses on a long drag with no velocity", () => {
    expect(shouldDismiss(H * 0.5, 0, H)).toBe(true);
  });

  it("dismisses a short but fast flick that a distance rule would refuse", () => {
    // 60px down at 1600px/s projects to 60 + 192 = 252, past the 221px gate.
    expect(shouldDismiss(60, 1600, H)).toBe(true);
    expect(projectedTranslation(60, 1600)).toBeCloseTo(252);
  });

  it("returns the sheet on an upward flick, however far down it got", () => {
    // Distance alone says yes; the finger says no, and the finger wins.
    expect(shouldDismiss(H * 0.8, -900, H)).toBe(false);
  });

  it("applies an absolute floor so a short sheet still needs a real drag", () => {
    const tiny = 100; // 30% would be 30px — a stray thumb
    expect(shouldDismiss(DISMISS_TRAVEL_MIN_PX - 1, 0, tiny)).toBe(false);
    expect(shouldDismiss(DISMISS_TRAVEL_MIN_PX, 0, tiny)).toBe(true);
  });
});

describe("closeDurationMs", () => {
  it("uses the unhurried close when the drag ended at a standstill", () => {
    expect(closeDurationMs(0, 0, H)).toBe(SHEET_CLOSE_MS);
  });

  it("never speeds up a slow drag past the ordinary close", () => {
    // 8px/s over 700px would be 87 seconds; the cap is what the user sees.
    expect(closeDurationMs(36, 8, H)).toBe(SHEET_CLOSE_MS);
  });

  it("matches a flick's own speed rather than decelerating under it", () => {
    // 236px left at 2000px/s ≈ 118ms — the sheet keeps the pace it was given.
    expect(closeDurationMs(500, 2000, H)).toBeCloseTo(118, 0);
  });

  it("floors a violent flick so the close is still visible", () => {
    expect(closeDurationMs(700, 20000, H)).toBe(SHEET_CLOSE_MIN_MS);
  });

  it("returns 0 when the sheet is already off-screen", () => {
    expect(closeDurationMs(H, 0, H)).toBe(0);
    expect(closeDurationMs(H + 50, 0, H)).toBe(0);
  });
});

describe("backdropOpacity", () => {
  it("is fully dim only with the sheet fully open", () => {
    expect(backdropOpacity(0, H)).toBeCloseTo(BACKDROP_OPACITY);
  });

  it("is clear with the sheet fully dismissed", () => {
    expect(backdropOpacity(H, H)).toBe(0);
  });

  it("tracks a drag in between, which is why it is derived", () => {
    expect(backdropOpacity(H / 2, H)).toBeCloseTo(BACKDROP_OPACITY / 2);
  });

  it("clamps outside the travel rather than over- or under-shooting", () => {
    expect(backdropOpacity(-80, H)).toBeCloseTo(BACKDROP_OPACITY);
    expect(backdropOpacity(H * 2, H)).toBe(0);
  });

  it("is clear before the sheet has been measured", () => {
    expect(backdropOpacity(0, 0)).toBe(0);
  });
});
