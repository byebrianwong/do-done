import { describe, expect, it } from "vitest";

import {
  SHEET_INSET_GAP,
  SHEET_MIN_BOTTOM_PAD,
  afterDismissMode,
  exitDurationMs,
  sheetBottomPadding,
} from "./bottom-sheet";
import {
  SHEET_CLOSE_MIN_MS,
  SHEET_CLOSE_MS,
  closeDurationMs,
} from "./sheet-motion";

describe("sheetBottomPadding", () => {
  it("keeps the old 28px on a phone that reports no inset", () => {
    expect(sheetBottomPadding(0)).toBe(SHEET_MIN_BOTTOM_PAD);
  });

  it("keeps the floor for a gesture bar shorter than it", () => {
    // A ~16dp gesture pill plus the gap is still under 28.
    expect(sheetBottomPadding(16)).toBe(SHEET_MIN_BOTTOM_PAD);
  });

  it("clears three-button navigation", () => {
    // 48dp of buttons: the last row has to sit above them, not under.
    expect(sheetBottomPadding(48)).toBe(48 + SHEET_INSET_GAP);
    expect(sheetBottomPadding(48)).toBeGreaterThan(48);
  });

  it("clears the iPhone home indicator", () => {
    expect(sheetBottomPadding(34)).toBe(34 + SHEET_INSET_GAP);
  });

  it("treats a missing or nonsense inset as none", () => {
    expect(sheetBottomPadding(-5)).toBe(SHEET_MIN_BOTTOM_PAD);
    expect(sheetBottomPadding(Number.NaN)).toBe(SHEET_MIN_BOTTOM_PAD);
  });
});

describe("exitDurationMs", () => {
  const h = 400;

  it("takes the ordinary close from the open position", () => {
    expect(exitDurationMs(0, 0, h)).toBe(SHEET_CLOSE_MS);
  });

  it("is shorter from part way down", () => {
    expect(exitDurationMs(h / 2, 0, h)).toBe(SHEET_CLOSE_MS / 2);
  });

  it("never drops under the floor while there is distance left", () => {
    expect(exitDurationMs(h * 0.99, 0, h)).toBe(SHEET_CLOSE_MIN_MS);
  });

  it("is instant when the sheet is already off screen", () => {
    expect(exitDurationMs(h, 0, h)).toBe(0);
    expect(exitDurationMs(h * 2, 0, h)).toBe(0);
  });

  it("keeps a flick's speed, as the task editor does", () => {
    expect(exitDurationMs(100, 3000, h)).toBe(closeDurationMs(100, 3000, h));
    expect(exitDurationMs(100, 3000, h)).toBeLessThan(SHEET_CLOSE_MS);
  });

  it("is instant for a sheet that never laid out", () => {
    expect(exitDurationMs(0, 0, 0)).toBe(0);
  });
});

describe("afterDismissMode", () => {
  it("waits for the native dismissal on iOS", () => {
    expect(afterDismissMode("ios")).toBe("after-dismiss");
  });

  it("runs inline on Android, which has no onDismiss to wait for", () => {
    expect(afterDismissMode("android")).toBe("inline");
  });
});
