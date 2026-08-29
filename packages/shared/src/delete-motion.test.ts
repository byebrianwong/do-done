import { describe, it, expect } from "vitest";
import {
  TASK_COMPLETE_EXIT_MS,
  TASK_COMPLETE_HOLD_MS,
  TASK_COMPLETE_SLIDE_PX,
  TASK_COMPLETE_SLIDE_SCALE,
  TASK_DELETE_COLLAPSE_MS,
  TASK_DELETE_DIM_OPACITY,
  TASK_DELETE_EXIT_MS,
  TASK_DELETE_HOLD_MS,
  TASK_DELETE_SLIDE_PX,
  TASK_DELETE_SLIDE_SCALE,
  UNDO_TOAST_TTL_MS,
} from "./constants.js";

/**
 * Deletion is the opposite of the completion gesture, and it exists because a
 * row leaving silently told the user nothing. Every assertion
 * here is about it staying *distinguishable* from a completion and staying
 * inside the window the toast promises — neither of which any type-checker or
 * either implementation (Tailwind plus inline styles on web, Reanimated on
 * mobile) can notice going wrong.
 */
describe("task deletion motion", () => {
  it("keeps the envelope at hold + collapse and nothing else", () => {
    // The same contract completion has: everything that drops the row from a
    // list waits exactly this long, so a layer outliving it strands the row.
    expect(TASK_DELETE_EXIT_MS).toBe(
      TASK_DELETE_HOLD_MS + TASK_DELETE_COLLAPSE_MS
    );
  });

  it("leaves the other way from a completion", () => {
    // The one thing that must never be ambiguous. Rightward is "filed", and it
    // continues mobile's swipe-right-to-complete; leftward is "removed", and it
    // continues the swipe that reveals Delete.
    expect(TASK_DELETE_SLIDE_PX).toBeLessThan(0);
    expect(TASK_COMPLETE_SLIDE_PX).toBeGreaterThan(0);
  });

  it("leaves harder than a completion does", () => {
    // A completed row is being put somewhere and has to stay recognisable while
    // the toast offers it back. A deleted one is being taken out of the list.
    expect(Math.abs(TASK_DELETE_SLIDE_PX)).toBeGreaterThan(
      TASK_COMPLETE_SLIDE_PX
    );
    expect(TASK_DELETE_SLIDE_SCALE).toBeLessThan(TASK_COMPLETE_SLIDE_SCALE);
  });

  it("holds for less time than a completion", () => {
    // The completion hold marks a state the task passed through. This one is
    // only long enough to
    // see which row is going.
    expect(TASK_DELETE_HOLD_MS).toBeLessThan(TASK_COMPLETE_HOLD_MS);
    expect(TASK_DELETE_EXIT_MS).toBeLessThan(TASK_COMPLETE_EXIT_MS);
  });

  it("holds long enough to be seen at all", () => {
    // Below roughly this the row is gone within a frame or two of the tap,
    // which is the bug the whole gesture exists to fix.
    expect(TASK_DELETE_HOLD_MS).toBeGreaterThanOrEqual(150);
  });

  it("keeps the condemned row readable while it is held", () => {
    // Reading the row IS the hold's purpose, so the dim can't approach zero;
    // the rest of the fade belongs to the collapse.
    expect(TASK_DELETE_DIM_OPACITY).toBeGreaterThanOrEqual(0.4);
    expect(TASK_DELETE_DIM_OPACITY).toBeLessThan(1);
  });

  it("outlasts both exits with the undo window", () => {
    // The toast is the row's receipt and it goes up as the row leaves. A window
    // that expired inside the animation would hand the user an Undo that was
    // already gone by the time they could see what had happened.
    expect(UNDO_TOAST_TTL_MS).toBeGreaterThan(TASK_DELETE_EXIT_MS * 4);
    expect(UNDO_TOAST_TTL_MS).toBeGreaterThan(TASK_COMPLETE_EXIT_MS * 4);
  });

  it("keeps the undo window at 1.5× the original six seconds", () => {
    // Recorded rather than implied: the number is a deliberate widening, not a
    // value that drifted, and shrinking it back is a product decision someone
    // should have to make on purpose.
    expect(UNDO_TOAST_TTL_MS).toBe(9000);
  });
});
