/**
 * The URL half of the task editor. This is what makes a task shareable, and
 * none of it is visible on screen — the editor looks identical whether the
 * address bar is telling the truth or not, so the sequencing is only checkable
 * here.
 *
 * What matters: opening pushes exactly one history entry (so Back closes the
 * editor rather than leaving the view), closing puts the URL back the way it
 * was, and a pasted link resolves without a row on screen — and closes by
 * stripping the param, since going "back" from an arrival would leave the app.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Task } from "@do-done/shared";
import { OpenTaskProvider, useOpenTask } from "./open-task";
import { makeTask } from "@/components/__stories__/mocks";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
}));

const getById = vi.fn();
vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => ({ getById }),
}));

const TASK = makeTask({ id: "task-1", title: "Buy milk" });
const OTHER = makeTask({ id: "task-2", title: "Post the letter" });

function mount(onMissing?: () => void) {
  return renderHook(() => useOpenTask(), {
    wrapper: ({ children }) => (
      <OpenTaskProvider onMissing={onMissing}>{children}</OpenTaskProvider>
    ),
  });
}

/** The `?task=` id currently in the address bar. */
function paramId(): string | null {
  return new URLSearchParams(window.location.search).get("task");
}

beforeEach(() => {
  getById.mockReset();
  getById.mockResolvedValue({ data: null, error: null });
  // Land every test on the same clean entry.
  window.history.replaceState(null, "", "/today");
});

describe("OpenTaskProvider — opening", () => {
  it("puts the open task in the address bar without leaving the view", () => {
    const { result } = mount();

    act(() => result.current!.open(TASK as Task));

    expect(result.current!.task?.id).toBe("task-1");
    expect(paramId()).toBe("task-1");
    expect(window.location.pathname).toBe("/today");
  });

  it("swaps tasks in place rather than stacking a second history entry", async () => {
    const { result } = mount();

    act(() => result.current!.open(TASK as Task));
    act(() => result.current!.open(OTHER as Task));
    expect(paramId()).toBe("task-2");

    // One Back should still land clear of the editor, not on the first task.
    act(() => result.current!.close());
    await waitFor(() => expect(paramId()).toBeNull());
    expect(result.current!.task).toBeNull();
  });
});

describe("OpenTaskProvider — on the task's own page", () => {
  it("adds no redundant param, but Back still closes the editor", async () => {
    window.history.replaceState(null, "", "/task/task-1");
    const { result } = mount();

    act(() => result.current!.open(TASK as Task));
    expect(paramId()).toBeNull();
    expect(result.current!.task?.id).toBe("task-1");

    act(() => {
      window.history.back();
    });

    await waitFor(() => expect(result.current!.task).toBeNull());
    expect(window.location.pathname).toBe("/task/task-1");
  });
});

describe("OpenTaskProvider — closing", () => {
  it("pops the entry it pushed, so Back and Esc leave the same history", async () => {
    const { result } = mount();
    act(() => result.current!.open(TASK as Task));

    act(() => result.current!.close());

    expect(result.current!.task).toBeNull();
    await waitFor(() => expect(paramId()).toBeNull());
    expect(window.location.pathname).toBe("/today");
  });

  it("closes when the user presses Back", async () => {
    const { result } = mount();
    act(() => result.current!.open(TASK as Task));

    act(() => {
      window.history.back();
    });

    await waitFor(() => expect(result.current!.task).toBeNull());
    expect(paramId()).toBeNull();
  });
});

describe("OpenTaskProvider — a link someone was sent", () => {
  it("resolves the task from `?task=` with no row on screen", async () => {
    window.history.replaceState(null, "", "/today?task=task-1");
    getById.mockResolvedValue({ data: TASK, error: null });

    const { result } = mount();

    await waitFor(() => expect(result.current!.task?.id).toBe("task-1"));
    expect(getById).toHaveBeenCalledWith("task-1");
  });

  it("closes by stripping the param — the arrival entry isn't ours to pop", async () => {
    window.history.replaceState(null, "", "/today?task=task-1");
    getById.mockResolvedValue({ data: TASK, error: null });
    const { result } = mount();
    await waitFor(() => expect(result.current!.task?.id).toBe("task-1"));

    act(() => result.current!.close());

    expect(paramId()).toBeNull();
    expect(window.location.pathname).toBe("/today");
  });

  it("clears a dead id instead of leaving it in the address bar", async () => {
    window.history.replaceState(null, "", "/today?task=gone");
    getById.mockResolvedValue({ data: null, error: null });
    const onMissing = vi.fn();

    const { result } = mount(onMissing);

    await waitFor(() => expect(onMissing).toHaveBeenCalled());
    expect(paramId()).toBeNull();
    expect(result.current!.task).toBeNull();
  });
});

describe("OpenTaskProvider — outside the provider", () => {
  it("reports null so a row can fall back to its own modal state", () => {
    const { result } = renderHook(() => useOpenTask());
    expect(result.current).toBeNull();
  });
});
