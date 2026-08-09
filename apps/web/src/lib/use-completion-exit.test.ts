import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  TASK_COMPLETE_COLLAPSE_MS,
  TASK_COMPLETE_HALO_MS,
  TASK_COMPLETE_HOLD_MS,
} from "@do-done/shared";
import { useCompletionExit } from "./use-completion-exit";

/** Point `matchMedia` at a fixed reduce-motion answer. */
function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduce })) as unknown as typeof window.matchMedia
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCompletionExit", () => {
  it("holds at full height before it collapses", () => {
    const { result } = renderHook(() => useCompletionExit());
    const gone = vi.fn();

    act(() => result.current.start(gone));

    // The row is completed but still occupying its space — this is the beat
    // where the task reads as done rather than merely gone.
    expect(result.current.phase).toBe("holding");
    expect(result.current.collapsing).toBe(false);

    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_HOLD_MS - 1));
    expect(result.current.collapsing).toBe(false);
  });

  it("collapses for exactly as long as the rows below take to travel", () => {
    const { result } = renderHook(() => useCompletionExit());
    const gone = vi.fn();

    act(() => result.current.start(gone));
    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_HOLD_MS));
    expect(result.current.collapsing).toBe(true);

    // Not gone yet — dropping the row here would cut the collapse short and
    // the rows below would jump the rest of the way.
    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_COLLAPSE_MS - 1));
    expect(gone).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("cancel snaps back to full height and never reports gone", () => {
    const { result } = renderHook(() => useCompletionExit());
    const gone = vi.fn();

    act(() => result.current.start(gone));
    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_HOLD_MS));
    expect(result.current.collapsing).toBe(true);

    // A failed write: the task is not complete, so the row has to come back.
    act(() => result.current.cancel());
    expect(result.current.phase).toBe("idle");

    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_COLLAPSE_MS * 4));
    expect(gone).not.toHaveBeenCalled();
  });

  it("skips the whole timeline under reduce motion", () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useCompletionExit());
    const gone = vi.fn();

    act(() => result.current.start(gone));

    // No hold, no collapse, no animation to sit through — the row is dropped
    // on the spot, which is what the setting asks for.
    expect(gone).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("idle");
  });

  it("does not fire gone after the row unmounts", () => {
    const { result, unmount } = renderHook(() => useCompletionExit());
    const gone = vi.fn();

    act(() => result.current.start(gone));
    unmount();

    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_HOLD_MS * 4));
    expect(gone).not.toHaveBeenCalled();
  });

  it("restarting drops the previous timeline", () => {
    const { result } = renderHook(() => useCompletionExit());
    const first = vi.fn();
    const second = vi.fn();

    act(() => result.current.start(first));
    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_HOLD_MS));
    act(() => result.current.start(second));

    // Back to holding, and the abandoned run must not still be counting down.
    expect(result.current.phase).toBe("holding");
    act(() =>
      void vi.advanceTimersByTime(
        TASK_COMPLETE_HOLD_MS + TASK_COMPLETE_COLLAPSE_MS
      )
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("useCompletionExit — the halo", () => {
  it("rings out once and then stops existing", () => {
    const { result } = renderHook(() => useCompletionExit());

    expect(result.current.pulsing).toBe(false);
    act(() => result.current.pulse());
    expect(result.current.pulsing).toBe(true);

    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_HALO_MS - 1));
    expect(result.current.pulsing).toBe(true);

    // Unmounted afterwards, so a re-render can't restart a finished animation.
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.pulsing).toBe(false);
  });

  it("survives the exit starting on top of it", () => {
    const { result } = renderHook(() => useCompletionExit());

    // The real order in `handleToggleComplete`: pulse, then start. These used
    // to share a timer list, so `start`'s clear-down killed the pulse's own
    // clean-up and left the halo on screen for the life of the row.
    act(() => {
      result.current.pulse();
      result.current.start(vi.fn());
    });
    expect(result.current.pulsing).toBe(true);

    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_HALO_MS));
    expect(result.current.pulsing).toBe(false);
  });

  it("takes the halo back when the write fails", () => {
    const { result } = renderHook(() => useCompletionExit());

    act(() => {
      result.current.pulse();
      result.current.start(vi.fn());
    });
    // A write that failed gets no celebration.
    act(() => result.current.cancel());
    expect(result.current.pulsing).toBe(false);

    act(() => void vi.advanceTimersByTime(TASK_COMPLETE_HALO_MS * 4));
    expect(result.current.pulsing).toBe(false);
  });

  it("does not ring under reduce motion", () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useCompletionExit());

    act(() => result.current.pulse());
    expect(result.current.pulsing).toBe(false);
  });
});
