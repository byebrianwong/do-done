import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Project } from "@do-done/shared";
import { SPARK_COUNT } from "@do-done/shared";
import { SectionOpenProvider } from "@/lib/task-row-behavior";
import { CompletionStreakProvider } from "@/lib/completion-streak";
import { addDaysLocalISO } from "@do-done/shared";
import { TaskItem } from "./task-item";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/**
 * The row's data door. `complete`/`reopen` deliberately never settle, so the
 * row stays in the optimistic state the completion animation is about — a
 * resolved write would refresh it out from under the assertion, and a rejected
 * one would revert it.
 */
const { tasksApiMock } = vi.hoisted(() => ({
  tasksApiMock: {
    listCompleted: vi.fn(async () => ({ data: [], error: null })),
    complete: vi.fn(() => new Promise(() => {})),
    reopen: vi.fn(() => new Promise(() => {})),
  } as Record<string, unknown>,
}));
vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => tasksApiMock,
  getTasksApiFor: () => tasksApiMock,
}));

// Isolate the row from the (heavy) edit modal subtree, but keep the real
// helper exports (useClickOutside, PickerPopover, …) the row's inline editors
// import from this module — a bare factory drops them and crashes the render.
vi.mock("./task-edit-modal-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./task-edit-modal-v2")>()),
  TaskEditModalV2: () => null,
}));

describe("TaskItem — touch affordances", () => {
  it("keeps the row action buttons visible on touch (mobile) and hover-revealed on desktop", () => {
    render(<TaskItem task={makeTask({ title: "Write report" })} projects={SAMPLE_PROJECTS} />);

    const editButton = screen.getByLabelText("Edit task");
    const actions = editButton.parentElement as HTMLElement;

    // Visible by default (touch has no hover)…
    expect(actions.className).toContain("opacity-100");
    // …but quietly hidden until hover on pointer (md+) devices.
    expect(actions.className).toContain("md:opacity-0");
    expect(actions.className).toContain("md:group-hover/row:opacity-100");
  });

  it("still exposes the complete toggle (core functionality) on mobile", () => {
    render(<TaskItem task={makeTask({ title: "Buy milk" })} />);
    expect(
      screen.getByRole("button", { name: /mark (in)?complete/i })
    ).toBeInTheDocument();
  });
});

describe("TaskItem — project chip stays in sync with props", () => {
  // Regression: editing a task elsewhere (e.g. the edit modal) re-feeds fresh
  // props after router.refresh; the row's optimistic projectId must follow.
  it("updates the chip when the task is reassigned to another project", () => {
    const task = makeTask({ title: "Ship it", project_id: "proj-1" });
    const { rerender } = render(
      <TaskItem task={task} projects={SAMPLE_PROJECTS} />
    );
    expect(screen.getByText("Engineering")).toBeInTheDocument();

    rerender(
      <TaskItem task={{ ...task, project_id: "proj-2" }} projects={SAMPLE_PROJECTS} />
    );
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.queryByText("Engineering")).not.toBeInTheDocument();
  });

  it("updates the chip when the project itself is renamed", () => {
    const task = makeTask({ title: "Ship it", project_id: "proj-1" });
    const { rerender } = render(
      <TaskItem task={task} projects={SAMPLE_PROJECTS} />
    );
    expect(screen.getByText("Engineering")).toBeInTheDocument();

    const renamed: Project[] = SAMPLE_PROJECTS.map((p) =>
      p.id === "proj-1" ? { ...p, name: "Platform" } : p
    );
    rerender(<TaskItem task={task} projects={renamed} />);
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.queryByText("Engineering")).not.toBeInTheDocument();
  });
});

describe("TaskItem — subtask reference", () => {
  // A subtask must read as a subtask and point at its parent. When the caller
  // supplies the parent, the row shows a "↳ parent" breadcrumb linking to the
  // parent's detail page — no extra fetch.
  it("shows a breadcrumb link to the parent task", () => {
    const sub = makeTask({
      title: "Write launch copy",
      parent_task_id: "parent-1",
      depth: 1,
    });
    render(
      <TaskItem
        task={sub}
        parentTask={{ id: "parent-1", title: "Ship the launch" }}
      />
    );
    const link = screen.getByRole("link", { name: /Ship the launch/i });
    expect(link).toHaveAttribute("href", "/task/parent-1");
  });

  it("omits the breadcrumb for a top-level task", () => {
    render(<TaskItem task={makeTask({ title: "Standalone task" })} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("suppresses the breadcrumb when hideParentRef is set", () => {
    const sub = makeTask({
      title: "Write launch copy",
      parent_task_id: "parent-1",
      depth: 1,
    });
    render(
      <TaskItem
        task={sub}
        parentTask={{ id: "parent-1", title: "Ship the launch" }}
        hideParentRef
      />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("TaskItem — status badge redundancy", () => {
  // Status-grouped lists (All tasks, Project) render a group header that already
  // states the status for every row, so the per-row pill is pure redundancy —
  // `hideStatusBadge` suppresses it there while leaving other views untouched.
  it("shows the status pill by default for a non-default status", () => {
    render(<TaskItem task={makeTask({ title: "Ship it", status: "next" })} />);
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  it("hides the status pill when hideStatusBadge is set", () => {
    render(
      <TaskItem
        task={makeTask({ title: "Ship it", status: "next" })}
        hideStatusBadge
      />
    );
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });
});

describe("TaskItem — the strike-through is drawn, not switched on", () => {
  it("carries the drawn rule rather than a line-through class", () => {
    const { container } = render(
      <TaskItem task={makeTask({ title: "Ship it", status: "done" })} />
    );

    const strike = container.querySelector(".dd-strike");
    expect(strike).not.toBeNull();
    // A completed row mounts already struck. Transitions don't run on first
    // paint, so it renders drawn rather than animating in on page load.
    expect(strike!.className).toContain("dd-strike-on");

    // `line-through` is what this replaces: it flipped on instantly, on the
    // tap's own frame, while every other part of the gesture eased.
    const title = strike!.parentElement as HTMLElement;
    expect(title.className).not.toContain("line-through");
  });

  it("leaves an open task's rule undrawn", () => {
    const { container } = render(
      <TaskItem task={makeTask({ title: "Ship it" })} />
    );
    const strike = container.querySelector(".dd-strike");
    expect(strike).not.toBeNull();
    expect(strike!.className).not.toContain("dd-strike-on");
  });

  it("never rings the halo for a row that merely renders completed", () => {
    // The halo marks the *moment* a task was ticked off. Keying it off the
    // completed state instead would set every row in a Completed list going
    // the instant the page painted.
    const { container } = render(
      <TaskItem task={makeTask({ title: "Ship it", status: "done" })} />
    );
    expect(container.querySelector(".dd-check-halo")).toBeNull();
  });

  it("offers the ghost check on an open row and withdraws it on a done one", () => {
    // The hint is what tells a first-time visitor the ring is a button at all.
    // It is a hint about an *available* action, though, so a completed row must
    // not carry one: the real check is already sitting there, and a faint
    // second one behind it only muddies which state the task is in. The
    // appearing itself is CSS (`:hover`, untestable in jsdom) — what this
    // pins is which rows have anything to appear.
    const open = render(<TaskItem task={makeTask({ title: "Ship it" })} />);
    expect(open.container.querySelector(".dd-check-ghost")).not.toBeNull();

    const done = render(
      <TaskItem task={makeTask({ title: "Ship it", status: "done" })} />
    );
    expect(done.container.querySelector(".dd-check-ghost")).toBeNull();
  });
});

describe("TaskItem — the celebratory burst is gated", () => {
  /**
   * The burst fires on a completion that earned it, and the gate lives in
   * `sparkReason` (unit-tested in `@do-done/shared`). What matters here is that
   * the row asks the right question: it must read the counts its *surroundings*
   * publish, since a row on its own cannot know it just emptied a section.
   */
  async function completeFirstRow(container: HTMLElement) {
    const box = screen.getAllByRole("button", { name: /mark complete/i })[0];
    await act(async () => {
      fireEvent.click(box);
    });
    return container.querySelectorAll(".dd-spark").length;
  }

  it("stays quiet for an ordinary task in a section with work left", async () => {
    const task = makeTask({ title: "Buy milk", priority: "p3" });
    const { container } = render(
      <SectionOpenProvider tasks={[task, makeTask({ title: "And eggs" })]}>
        <TaskItem task={task} />
      </SectionOpenProvider>
    );
    expect(await completeFirstRow(container)).toBe(0);
  });

  it("fires when the completion empties its section", async () => {
    const task = makeTask({ title: "The last one", priority: "p3" });
    const { container } = render(
      <SectionOpenProvider tasks={[task]}>
        <TaskItem task={task} />
      </SectionOpenProvider>
    );
    expect(await completeFirstRow(container)).toBe(SPARK_COUNT);
  });

  it("fires for a high-priority task even mid-section", async () => {
    const task = makeTask({ title: "Urgent thing", priority: "p1" });
    const { container } = render(
      <SectionOpenProvider tasks={[task, makeTask({ title: "Other" })]}>
        <TaskItem task={task} />
      </SectionOpenProvider>
    );
    expect(await completeFirstRow(container)).toBe(SPARK_COUNT);
  });

  it("fires for two hours of work", async () => {
    const task = makeTask({
      title: "Long haul",
      priority: "p3",
      duration_minutes: 120,
    });
    const { container } = render(
      <SectionOpenProvider tasks={[task, makeTask({ title: "Other" })]}>
        <TaskItem task={task} />
      </SectionOpenProvider>
    );
    expect(await completeFirstRow(container)).toBe(SPARK_COUNT);
  });

  it("counts the section as it stood before the tap, not after", async () => {
    // The row's completed state is optimistic and local; the section's array
    // still comes from the props the list rendered with. So the task being
    // ticked off is still among the open ones, and one means "this is the last".
    const task = makeTask({ title: "Solo", priority: "p3" });
    const { container } = render(
      <SectionOpenProvider tasks={[task]}>
        <TaskItem task={task} />
      </SectionOpenProvider>
    );
    expect(await completeFirstRow(container)).toBe(SPARK_COUNT);
  });

  it("never fires where no surface published a count", async () => {
    // The inbox, search and the drag overlay have no sections. Absence must
    // read as "can't tell", never as an empty one.
    const task = makeTask({ title: "Loose task", priority: "p3" });
    const { container } = render(<TaskItem task={task} />);
    expect(await completeFirstRow(container)).toBe(0);
  });

  it("never fires on reopening a completed task", async () => {
    const task = makeTask({ title: "Back again", priority: "p1", status: "done" });
    const { container } = render(
      <SectionOpenProvider tasks={[task]}>
        <TaskItem task={task} />
      </SectionOpenProvider>
    );
    const box = screen.getByRole("button", { name: /mark incomplete/i });
    await act(async () => {
      fireEvent.click(box);
    });
    expect(container.querySelectorAll(".dd-spark")).toHaveLength(0);
  });
});

describe("TaskItem — the streak rule", () => {
  /**
   * The streak is the one gate rule with data behind it, and the row reads it
   * through a provider. What is worth asserting is the wiring: an ordinary task
   * in a section with work left sparks *only* because the day's run says so.
   */
  const listCompleted = tasksApiMock.listCompleted as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listCompleted.mockReset();
  });

  function renderRow() {
    const task = makeTask({ title: "Ordinary thing", priority: "p3" });
    return render(
      <CompletionStreakProvider>
        <SectionOpenProvider tasks={[task, makeTask({ title: "Another" })]}>
          <TaskItem task={task} />
        </SectionOpenProvider>
      </CompletionStreakProvider>
    );
  }

  async function settle() {
    // Let the provider's one fetch land before anything is clicked.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function clickComplete(container: HTMLElement) {
    const box = screen.getAllByRole("button", { name: /mark complete/i })[0];
    await act(async () => {
      fireEvent.click(box);
    });
    return container.querySelectorAll(".dd-spark").length;
  }

  function history(days: string[]) {
    listCompleted.mockResolvedValue({
      data: days.map((d) => ({
        completed_at: new Date(`${d}T12:00:00`).toISOString(),
      })),
      error: null,
    });
  }

  it("fires for the completion that keeps a run alive", async () => {
    history([addDaysLocalISO(-1), addDaysLocalISO(-2)]);
    const { container } = renderRow();
    await settle();
    expect(await clickComplete(container)).toBe(SPARK_COUNT);
  });

  it("stays quiet when today merely starts a run", async () => {
    // A streak of one is just a Tuesday.
    history([addDaysLocalISO(-4)]);
    const { container } = renderRow();
    await settle();
    expect(await clickComplete(container)).toBe(0);
  });

  it("stays quiet when today already had a completion", async () => {
    history([addDaysLocalISO(0), addDaysLocalISO(-1)]);
    const { container } = renderRow();
    await settle();
    expect(await clickComplete(container)).toBe(0);
  });

  it("never guesses before the history has loaded", async () => {
    listCompleted.mockReturnValue(new Promise(() => {}));
    const { container } = renderRow();
    expect(await clickComplete(container)).toBe(0);
  });
});
