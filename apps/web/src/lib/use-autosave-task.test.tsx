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
import {
  useAutoSaveTask,
  SAVED_FLASH_MS,
  RETRY_BACKOFF_MS,
} from "@do-done/api-client";
import type { TasksApi } from "@do-done/api-client";
import { TASK_DESCRIPTION_MAX_LENGTH } from "@do-done/shared";
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

/**
 * The class of failure that made a single bad field look like "the task won't
 * save": the patch was diffed against the *mount* snapshot, so a rejected value
 * was re-sent with — and sank — every later edit.
 */
describe("useAutoSaveTask — one bad field doesn't sink the rest", () => {
  const tooLong = "x".repeat(TASK_DESCRIPTION_MAX_LENGTH + 1);

  /** An api whose `update` always succeeds, recording what it was sent. */
  function recordingApi() {
    const update = vi.fn(async () => ({ data: null, error: null }));
    return { api: { update } as unknown as TasksApi, update };
  }

  it("sends the valid fields and holds back only the invalid one", async () => {
    const { api, update } = recordingApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("description", tooLong));
    act(() => result.current.setField("priority", "p1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });

    expect(update).toHaveBeenCalledTimes(1);
    const [, patch] = update.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(patch).toEqual({ priority: "p1" });
    expect(result.current.fieldErrors.description).toContain("Notes");
  });

  it("keeps saving later edits instead of re-sending the rejected value", async () => {
    const { api, update } = recordingApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("description", tooLong));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });

    // The edit that used to be collateral damage: before the fix this PATCH
    // still carried the oversized description and failed with it.
    act(() => result.current.setField("title", "Still saves"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });

    const last = update.mock.calls.at(-1) as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(last[1]).toEqual({ title: "Still saves" });
    expect(last[1]).not.toHaveProperty("description");
  });

  it("won't report Saved while a field is still being held back", async () => {
    const { api } = recordingApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("description", tooLong));
    act(() => result.current.setField("priority", "p1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });

    // `priority` committed, but the notes did not — "Saved" would be a lie
    // about the part the user is most likely watching.
    expect(result.current.status).toBe("error");
    expect(result.current.hasUnsavedWork).toBe(true);
  });

  it("stops re-sending a field once the server has taken it", async () => {
    const { api, update } = recordingApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("title", "First"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    act(() => result.current.setField("priority", "p1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });

    // Diffing against the mount snapshot would put `title` in this patch too.
    const last = update.mock.calls.at(-1) as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(last[1]).toEqual({ priority: "p1" });
  });

  it("clears a field's complaint as soon as the user edits it back", async () => {
    const { api } = recordingApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("description", tooLong));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    expect(result.current.fieldErrors.description).toBeDefined();

    act(() => result.current.setField("description", "short again"));
    expect(result.current.fieldErrors.description).toBeUndefined();
  });

  it("doesn't retry a validation failure — it can't fix itself", async () => {
    const { api, update } = recordingApi();
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("description", tooLong));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    // Nothing was sendable, so nothing was sent.
    expect(update).not.toHaveBeenCalled();

    // Well past every backoff step: hammering the server with a patch we
    // already know is invalid helps nobody.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(update).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
  });
});

describe("useAutoSaveTask — transient failures", () => {
  it("retries on a backoff so a last keystroke isn't lost to a blip", async () => {
    // Fails once, then recovers — the network blip this exists for.
    let calls = 0;
    const update = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? { data: null, error: new Error("network") }
        : { data: null, error: null };
    });
    const api = { update } as unknown as TasksApi;
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("title", "Ship it"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    expect(result.current.status).toBe("error");

    // Nobody typed again; the recovery has to come from the hook itself.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("saved");
    expect(result.current.hasUnsavedWork).toBe(false);
  });

  it("gives up after the last backoff step rather than retrying forever", async () => {
    const update = vi.fn(async () => ({
      data: null,
      error: new Error("still down"),
    }));
    const api = { update } as unknown as TasksApi;
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("title", "Ship it"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // One original attempt plus one per backoff step, and then it stops.
    expect(update).toHaveBeenCalledTimes(1 + RETRY_BACKOFF_MS.length);
    expect(result.current.status).toBe("error");
    // Still flagged, so the close guard has something to stop on.
    expect(result.current.hasUnsavedWork).toBe(true);
  });

  it("retries on demand, without waiting out the backoff", async () => {
    let failing = true;
    const update = vi.fn(async () =>
      failing
        ? { data: null, error: new Error("network") }
        : { data: null, error: null }
    );
    const api = { update } as unknown as TasksApi;
    const { result } = renderHook(() => useAutoSaveTask(makeTask(), api));

    act(() => result.current.setField("title", "Ship it"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE);
    });
    expect(result.current.status).toBe("error");

    failing = false;
    await act(async () => {
      result.current.retry();
    });

    expect(result.current.status).toBe("saved");
    expect(result.current.hasUnsavedWork).toBe(false);
  });
});
