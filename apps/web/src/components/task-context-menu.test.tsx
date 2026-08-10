import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskContextMenu } from "./task-context-menu";
import { makeTask } from "./__stories__/mocks";

// Delete goes through `useDeleteTasks`, which holds the route refresh for the
// row's exit animation — so the menu now needs a router, the same way the row
// itself does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The menu writes straight through the client tasks API; capture the patch so
// tests can assert what a pick actually saved.
const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn() }));

vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => ({
    update: async (id: string, patch: unknown) => {
      updateSpy(id, patch);
      return { data: null, error: null };
    },
    create: async () => ({ data: null, error: null }),
  }),
}));

beforeEach(() => {
  updateSpy.mockClear();
});

function openMenu(priority: "p1" | "p2" | "p3" | "p4") {
  const task = makeTask({ priority });
  render(
    <TaskContextMenu task={task} onEdit={() => {}} onClose={() => {}} />
  );
  return task;
}

describe("TaskContextMenu priority", () => {
  it("picking the priority a task already has clears it to p4", async () => {
    const task = openMenu("p1");

    fireEvent.click(screen.getByLabelText("P1 Urgent"));

    await vi.waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(task.id, { priority: "p4" })
    );
  });

  it("picking a different priority sets it", async () => {
    const task = openMenu("p1");

    fireEvent.click(screen.getByLabelText("P3 Medium"));

    await vi.waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(task.id, { priority: "p3" })
    );
  });

  it("re-picking p4 leaves the task at p4 rather than cycling", async () => {
    const task = openMenu("p4");

    fireEvent.click(screen.getByLabelText("P4 Low"));

    await vi.waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(task.id, { priority: "p4" })
    );
  });
});
