import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskEditModalV2 } from "./task-edit-modal-v2";
import { makeTask } from "./__stories__/mocks";
import type { Task } from "@do-done/shared";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// A configurable data layer: tests seed `subtasksByParent` (what listSubtasks
// returns) and `byId` (what getById returns, powering the parent breadcrumb).
const { store } = vi.hoisted(() => ({
  store: {
    subtasksByParent: new Map<string, unknown[]>(),
    byId: new Map<string, unknown>(),
  },
}));

vi.mock("@do-done/api-client", () => ({
  // Passthrough autosave: the title <input> reflects whichever task is active,
  // so its value is our "which task is on screen" probe.
  useAutoSaveTask: (task: Task) => ({
    task,
    setField: vi.fn(),
    undoAll: vi.fn(),
    hasChanges: false,
    lastSavedAt: null,
    isSaving: false,
    lastError: null,
  }),
  TasksApi: class {
    async listSubtasks(parentId: string) {
      return { data: store.subtasksByParent.get(parentId) ?? [], error: null };
    }
    async getById(id: string) {
      return { data: store.byId.get(id) ?? null, error: null };
    }
    async update() {
      return { data: null, error: null };
    }
    async delete() {
      return { error: null };
    }
    async create() {
      return { data: null, error: null };
    }
  },
}));

beforeEach(() => {
  store.subtasksByParent.clear();
  store.byId.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ days: [] }) }))
  );
});

function titleInput(): HTMLInputElement {
  return screen.getByPlaceholderText(/Task title/i) as HTMLInputElement;
}

describe("TaskEditModalV2 — subtask navigation", () => {
  it("drills into a subtask when its row is clicked", async () => {
    const root = makeTask({ id: "root", title: "Root task" });
    const sub = makeTask({
      id: "sub-1",
      title: "Subtask one",
      parent_task_id: "root",
      depth: 1,
    });
    store.byId.set("root", root);
    store.byId.set("sub-1", sub);
    store.subtasksByParent.set("root", [sub]);

    render(<TaskEditModalV2 task={root} open onClose={vi.fn()} />);

    // Root is on screen; a top-level task shows no "back to parent" control.
    expect(titleInput().value).toBe("Root task");
    const row = await screen.findByText("Subtask one");
    expect(screen.queryByTitle(/Back to/)).toBeNull();

    fireEvent.click(row);

    // The modal now edits the subtask, and offers a way back to its parent.
    await waitFor(() => expect(titleInput().value).toBe("Subtask one"));
    expect(await screen.findByTitle(/Back to/)).toBeInTheDocument();
  });

  it("climbs back to the parent from a subtask", async () => {
    const root = makeTask({ id: "root", title: "Root task" });
    const sub = makeTask({
      id: "sub-1",
      title: "Subtask one",
      parent_task_id: "root",
      depth: 1,
    });
    store.byId.set("root", root);
    store.byId.set("sub-1", sub);
    store.subtasksByParent.set("root", [sub]);

    // Open the subtask directly (as if navigated from a list).
    render(<TaskEditModalV2 task={sub} open onClose={vi.fn()} />);

    expect(titleInput().value).toBe("Subtask one");
    const back = await screen.findByTitle(/Back to/);

    fireEvent.click(back);

    // Now editing the parent, which itself has no parent → no breadcrumb.
    await waitFor(() => expect(titleInput().value).toBe("Root task"));
    expect(screen.queryByTitle(/Back to/)).toBeNull();
  });
});
