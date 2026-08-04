/**
 * Runtime tests for `useAutoSaveTask`'s save-status reporting — the signal the
 * task editor's indicator is driven by.
 *
 * The hook ships from `@do-done/api-client`, but its tests live here: that
 * package runs plain node tests, and giving it a renderer would mean adding
 * jsdom + @testing-library there, which is exactly the multi-copy install the
 * root CLAUDE.md warns about. The pure transition table is unit-tested next to
 * the hook (`nextSaveStatus`); what's covered here is the wiring — that the
 * hook dispatches the right event at the right moment around a real await.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutoSaveTask, SAVED_FLASH_MS } from "@do-done/api-client";
import type { TasksApi } from "@do-done/api-client";
import { makeTask } from "@/components/__stories__/mocks";

/** A TasksApi stand-in whose `update` resolves when the test says so. */
function deferredApi() {
  let settle!: (v: { data: null; error: Error | null }) => void;
  const update = vi.fn(
    () =>
      new Promise<{ data: null; error: Error | null }>((res) => {
        settle = res;
      })
  );
  return {
    api: { update } as unknown as TasksApi,
    update,
    succeed: () => settle({ data: null, error: null }),
    fail: () => settle({ data: null, error: new Error("nope") }),
  };
}

const DEBOUNCE = 250;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useAutoSaveTask — save status", () => {
  it("reports pending on the keystroke, before the debounce has elapsed", async () => {
    const { api, update } = deferredApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    expect(result.current.status).toBe("idle");

    act(() => result.current.setField("title", "S"));

    // No timers advanced: this is the same tick as the keystroke, and the
    // request hasn't been made. Before `status` existed the indicator sat on
    // its resting label for this entire window.
    expect(result.current.status).toBe("pending");
    expect(update).not.toHaveBeenCalled();
    expect(result.current.isSaving).toBe(false);
  });

  it("stays pending across a run of keystrokes that keep restarting the debounce", async () => {
    const { api, update } = deferredApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    for (const title of ["S", "Sh", "Shi", "Ship"]) {
      act(() => result.current.setField("title", title));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE - 50);
      });
      expect(result.current.status).toBe("pending");
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("walks pending → saving → saved → idle across one commit", async () => {
    const { api, succeed } = deferredApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("title", "Ship it"));
    expect(result.current.status).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    expect(result.current.status).toBe("saving");

    await act(async () => {
      succeed();
    });
    expect(result.current.status).toBe("saved");

    // "Saved" is a flash, not a standing claim — it settles on its own.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVED_FLASH_MS);
    });
    expect(result.current.status).toBe("idle");
  });

  it("does not flash Saved over a keystroke typed while the request was in flight", async () => {
    const { api, succeed } = deferredApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("title", "Ship"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    expect(result.current.status).toBe("saving");

    // User types again mid-request, then the (now stale) request lands.
    act(() => result.current.setField("title", "Ship it"));
    await act(async () => {
      succeed();
    });

    expect(result.current.status).toBe("pending");
  });

  it("drops the pending hint when the queued patch turns out to be empty", async () => {
    const { api, update } = deferredApi();
    const task = makeTask();
    const { result } = renderHook(() => useAutoSaveTask(task, api));

    // Typed a character and deleted it inside one debounce window: the save
    // fires on an empty diff, so nothing is coming to clear `pending`.
    act(() => result.current.setField("title", `${task.title}!`));
    act(() => result.current.setField("title", task.title));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });

    expect(update).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("surfaces a failed save and recovers to pending on the next edit", async () => {
    const { api, fail } = deferredApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("title", "Ship it"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    await act(async () => {
      fail();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.lastError?.message).toBe("nope");

    act(() => result.current.setField("title", "Ship it again"));
    expect(result.current.status).toBe("pending");
  });
});
