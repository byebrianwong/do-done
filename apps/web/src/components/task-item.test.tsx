import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Project } from "@do-done/shared";
import { TaskItem } from "./task-item";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
    expect(actions.className).toContain("md:group-hover:opacity-100");
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
