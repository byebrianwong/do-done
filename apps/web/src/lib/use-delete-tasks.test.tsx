import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { TASK_DELETE_EXIT_MS, UNDO_TOAST_TTL_MS } from "@do-done/shared";
import { UndoToastProvider } from "@/components/undo-toast";
import { makeTask } from "@/components/__stories__/mocks";
import {
  TASK_DELETING_EVENT,
  type TaskDeletingDetail,
} from "./task-delete-events";
import { useDeleteTasks } from "./use-delete-tasks";

const { refreshSpy } = vi.hoisted(() => ({ refreshSpy: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshSpy }),
}));

const { deleteSpy, restoreSpy } = vi.hoisted(() => ({
  deleteSpy: vi.fn(async (id: string) => ({
    ids: [id] as string[],
    error: null as Error | null,
  })),
  restoreSpy: vi.fn(async () => ({ error: null as Error | null })),
}));
vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => ({ delete: deleteSpy, restore: restoreSpy }),
}));

/** Every `do-done:task-deleting` the run announced, in order. */
function recordAnnouncements(): TaskDeletingDetail[] {
  const seen: TaskDeletingDetail[] = [];
  window.addEventListener(TASK_DELETING_EVENT, (e) => {
    seen.push((e as CustomEvent<TaskDeletingDetail>).detail);
  });
  return seen;
}

function mount() {
  return renderHook(() => useDeleteTasks(), { wrapper: UndoToastProvider });
}

beforeEach(() => {
  refreshSpy.mockClear();
  deleteSpy
    .mockClear()
    .mockImplementation(async (id: string) => ({ ids: [id], error: null }));
  restoreSpy.mockClear().mockResolvedValue({ error: null });
});
afterEach(() => vi.useRealTimers());

describe("useDeleteTasks", () => {
  it("tells the rows before it touches the network", async () => {
    // The dim is the acknowledgement, so it cannot wait on a round-trip: on a
    // slow connection that would be a click with no answer for a second, which
    // is the disappearing-row bug with extra steps.
    const seen = recordAnnouncements();
    let sawAnnouncement = false;
    deleteSpy.mockImplementation(async (id: string) => {
      sawAnnouncement = seen.length > 0;
      return { ids: [id], error: null };
    });

    const { result } = mount();
    await act(() => result.current.deleteTasks([makeTask({ title: "Ship it" })]));

    expect(sawAnnouncement).toBe(true);
    expect(seen[0]).toMatchObject({ phase: "start" });
  });

  it("holds the refresh until the row has finished leaving", async () => {
    vi.useFakeTimers();
    const { result } = mount();

    let done = false;
    let run!: Promise<void>;
    act(() => {
      run = result.current
        .deleteTasks([makeTask({ title: "Ship it" })])
        .then(() => {
          done = true;
        });
    });

    // Let the write settle without letting the envelope elapse. Refreshing here
    // would yank the row out from under its own animation.
    await act(() => vi.advanceTimersByTimeAsync(TASK_DELETE_EXIT_MS - 20));
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(20));
    await run;
    expect(refreshSpy).toHaveBeenCalled();
    expect(done).toBe(true);
  });

  it("names the task in the toast, and offers it back", async () => {
    const { result } = mount();
    await act(() =>
      result.current.deleteTasks([makeTask({ title: "Post the letter" })])
    );

    expect(screen.getByText("Deleted “Post the letter”")).toBeInTheDocument();

    const undo = screen.getByRole("button", { name: /undo/i });
    await act(() => void undo.click());
    // Restored, not recreated — the row was never destroyed, so Undo gives back
    // the same task rather than a copy wearing its title.
    expect(restoreSpy).toHaveBeenCalledTimes(1);
  });

  it("gives back the subtree, not just the row that was clicked", async () => {
    // The fidelity the whole soft delete exists for. A task's subtasks are rows
    // the list never showed and the caller has no idea exist, so undo has to
    // work off what the *write* reported rather than what it was handed.
    deleteSpy.mockResolvedValue({
      ids: ["task-1", "child-1", "grandchild-1"],
      error: null,
    });
    const { result } = mount();
    await act(() =>
      result.current.deleteTasks([makeTask({ id: "task-1", title: "Ship it" })])
    );

    await act(() =>
      void screen.getByRole("button", { name: /undo/i }).click()
    );
    expect(restoreSpy).toHaveBeenCalledWith([
      "task-1",
      "child-1",
      "grandchild-1",
    ]);
  });

  it("counts them instead of naming them when there are several", async () => {
    const { result } = mount();
    await act(() =>
      result.current.deleteTasks([
        makeTask({ id: "a", title: "One" }),
        makeTask({ id: "b", title: "Two" }),
      ])
    );

    expect(screen.getByText("Deleted 2 tasks")).toBeInTheDocument();
  });

  it("takes the condemnation back when nothing was written", async () => {
    const seen = recordAnnouncements();
    deleteSpy.mockResolvedValue({ ids: [], error: new Error("offline") });
    const { result } = mount();

    await act(() => result.current.deleteTasks([makeTask({ title: "Ship it" })]));

    // The rows come back, and the toast says why rather than leaving them to
    // spring up with no explanation.
    expect(seen.map((d) => d.phase)).toEqual(["start", "cancel"]);
    expect(screen.getByText("Couldn't delete “Ship it”")).toBeInTheDocument();
    // Nothing to undo, so no button offering it — a dead Undo is worse than
    // none at all.
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it("keeps the rows that did land out of the list", async () => {
    // A partial failure is reported by the refreshed list, not by stranding the
    // whole batch mid-animation.
    deleteSpy
      .mockResolvedValueOnce({ ids: ["a"], error: null })
      .mockResolvedValueOnce({ ids: [], error: new Error("nope") });
    const { result } = mount();

    await act(() =>
      result.current.deleteTasks([
        makeTask({ id: "a", title: "One" }),
        makeTask({ id: "b", title: "Two" }),
      ])
    );

    expect(screen.getByText("Deleted “One”")).toBeInTheDocument();
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("says so when the undo itself fails", async () => {
    restoreSpy.mockResolvedValue({ error: new Error("offline") });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = mount();

    await act(() => result.current.deleteTasks([makeTask({ title: "Ship it" })]));
    await act(() =>
      void screen.getByRole("button", { name: /undo/i }).click()
    );

    expect(
      screen.getByText("Couldn't bring “Ship it” back")
    ).toBeInTheDocument();
  });
});

describe("the undo window", () => {
  it("outlives the row's exit by a wide margin", async () => {
    vi.useFakeTimers();
    const { result } = mount();

    let run!: Promise<void>;
    act(() => {
      run = result.current.deleteTasks([makeTask({ title: "Ship it" })]);
    });
    await act(() => vi.advanceTimersByTimeAsync(TASK_DELETE_EXIT_MS));
    await run;
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();

    // Still there long after the row has gone — the point of the widening is
    // that noticing a mistake takes longer than reading a toast.
    await act(() => vi.advanceTimersByTimeAsync(UNDO_TOAST_TTL_MS - 1000));
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });
});

describe("the undo shortcut", () => {
  function pressUndo() {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true })
    );
  }

  it("takes the last action back without reaching for the button", async () => {
    const { result } = mount();
    await act(() => result.current.deleteTasks([makeTask({ title: "Ship it" })]));

    await act(() => void pressUndo());
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("leaves a text field's own undo stack alone", async () => {
    // The shortcut is a convenience over the button, and it must never be the
    // reason a half-typed title loses its last word.
    const { result } = mount();
    await act(() => result.current.deleteTasks([makeTask({ title: "Ship it" })]));

    render(<input aria-label="Title" />);
    const input = screen.getByLabelText("Title");
    input.focus();
    await act(() =>
      void input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true })
      )
    );

    expect(restoreSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("is bound only while a toast with an undo is up", async () => {
    mount();
    await act(() => void pressUndo());
    expect(restoreSpy).not.toHaveBeenCalled();
  });
});
