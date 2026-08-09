import { describe, it, expect } from "vitest";
import {
  TASK_COMPLETE_ANTICIPATE_MS,
  TASK_COMPLETE_ANTICIPATE_SCALE,
  TASK_COMPLETE_CHECK_MS,
  TASK_COMPLETE_COLLAPSE_MS,
  TASK_COMPLETE_HALO_MS,
  TASK_COMPLETE_HOLD_MS,
  TASK_COMPLETE_EXIT_MS,
  TASK_COMPLETE_SLIDE_PX,
  TASK_COMPLETE_SLIDE_SCALE,
  TASK_COMPLETE_STRIKE_DELAY_MS,
  TASK_COMPLETE_STRIKE_MS,
  TASK_COMPLETE_TITLE_DELAY_MS,
} from "./constants.js";

/**
 * The completion gesture is three layers of motion over one fixed envelope, and
 * every one of these relationships is a design decision rather than a number
 * that happened to work. They are asserted here because the two implementations
 * — inline styles plus CSS on web, Reanimated worklets on mobile — share
 * nothing except these constants, so a change to one that breaks the intent has
 * no other place to fail.
 */
describe("task completion motion", () => {
  it("keeps the envelope at hold + collapse and nothing else", () => {
    // Anything that removes a row from a list waits exactly this long. Adding
    // a layer that outlives it would strand a row mid-animation.
    expect(TASK_COMPLETE_EXIT_MS).toBe(
      TASK_COMPLETE_HOLD_MS + TASK_COMPLETE_COLLAPSE_MS
    );
  });

  it("lands every added layer inside the envelope", () => {
    const layers = [
      { name: "check", end: TASK_COMPLETE_CHECK_MS },
      { name: "halo", end: TASK_COMPLETE_HALO_MS },
      {
        name: "strike",
        end: TASK_COMPLETE_STRIKE_DELAY_MS + TASK_COMPLETE_STRIKE_MS,
      },
      { name: "title", end: TASK_COMPLETE_TITLE_DELAY_MS + TASK_COMPLETE_CHECK_MS },
    ];
    for (const layer of layers) {
      expect(layer.end).toBeLessThanOrEqual(TASK_COMPLETE_EXIT_MS);
    }
  });

  it("finishes the check and the strike together", () => {
    // One is the control acknowledging the tap, the other is the text
    // acknowledging it, and the eye may be on either — so they have to land as
    // one event. The line starts a beat late precisely so they end level.
    const strikeEnd = TASK_COMPLETE_STRIKE_DELAY_MS + TASK_COMPLETE_STRIKE_MS;
    expect(Math.abs(strikeEnd - TASK_COMPLETE_CHECK_MS)).toBeLessThanOrEqual(20);
    expect(TASK_COMPLETE_STRIKE_DELAY_MS).toBeGreaterThan(0);
  });

  it("trails the title's colour behind the line rather than racing it", () => {
    expect(TASK_COMPLETE_TITLE_DELAY_MS).toBeGreaterThan(
      TASK_COMPLETE_STRIKE_DELAY_MS
    );
  });

  it("finishes everything on the way in before the row starts to leave", () => {
    // The slide is strictly after the hold, so it never shares the stage with
    // the check, the halo or the line.
    const inbound = Math.max(
      TASK_COMPLETE_CHECK_MS,
      TASK_COMPLETE_HALO_MS,
      TASK_COMPLETE_STRIKE_DELAY_MS + TASK_COMPLETE_STRIKE_MS
    );
    expect(inbound).toBeLessThanOrEqual(TASK_COMPLETE_HOLD_MS);
  });

  it("keeps the anticipation short enough to read as give, not drag", () => {
    expect(TASK_COMPLETE_ANTICIPATE_MS).toBeLessThan(TASK_COMPLETE_CHECK_MS);
    expect(TASK_COMPLETE_ANTICIPATE_SCALE).toBeGreaterThan(0.8);
    expect(TASK_COMPLETE_ANTICIPATE_SCALE).toBeLessThan(1);
  });

  it("keeps the exit's travel a nudge rather than a throw", () => {
    // Far enough to read as direction, near enough that the row is still
    // recognisably itself when the undo toast offers it back.
    expect(TASK_COMPLETE_SLIDE_PX).toBeGreaterThan(0);
    expect(TASK_COMPLETE_SLIDE_PX).toBeLessThanOrEqual(48);
    expect(TASK_COMPLETE_SLIDE_SCALE).toBeGreaterThan(0.9);
    expect(TASK_COMPLETE_SLIDE_SCALE).toBeLessThan(1);
  });
});
