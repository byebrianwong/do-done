import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickAddModal } from "./quick-add-modal";
import { OPEN_QUICK_ADD_EVENT } from "@/lib/quick-add-events";
import { makeTask } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const createdTask = makeTask({ id: "new-1", title: "Buy milk", user_id: "user-1" });
const createMock = vi.fn(async () => ({ data: createdTask, error: null }));

// The submit path goes through getClientTasksApi; stub it so we don't need a
// real Supabase session (the shared mock's getUser() resolves to null).
vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => ({ create: createMock }),
}));

// The handoff renders TaskEditModalV2 (auto-save) and the project chip builds a
// ProjectsApi; stub the data layer.
vi.mock("@do-done/api-client", () => ({
  useAutoSaveTask: (task: unknown) => ({
    task,
    setField: vi.fn(),
    undoAll: vi.fn(),
    hasChanges: false,
    lastSavedAt: null,
    isSaving: false,
    status: "idle",
    lastError: null,
  }),
  TasksApi: class {
    async listSubtasks() {
      return { data: [] };
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
  ProjectsApi: class {
    async list() {
      return { data: [] };
    }
  },
}));

beforeEach(() => {
  createMock.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ days: [] }) }))
  );
});

function openViaEvent() {
  act(() => {
    window.dispatchEvent(new CustomEvent(OPEN_QUICK_ADD_EVENT));
  });
}

describe("QuickAddModal", () => {
  it("is closed until the open event fires", () => {
    render(<QuickAddModal projects={[]} userId="user-1" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    openViaEvent();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens on the 'q' shortcut when focus is not in a text field", () => {
    render(<QuickAddModal projects={[]} userId="user-1" />);
    fireEvent.keyDown(document.body, { key: "q" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignores 'q' when typing in an input", () => {
    render(
      <>
        <input data-testid="external" />
        <QuickAddModal projects={[]} userId="user-1" />
      </>
    );
    fireEvent.keyDown(screen.getByTestId("external"), { key: "q" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores 'q' when a modifier is held (e.g. ⌘Q)", () => {
    render(<QuickAddModal projects={[]} userId="user-1" />);
    fireEvent.keyDown(document.body, { key: "q", metaKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'More options' does nothing with an empty title", () => {
    render(<QuickAddModal projects={[]} userId="user-1" />);
    openViaEvent();
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    expect(createMock).not.toHaveBeenCalled();
    // Quick-add stays open.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("'More options' creates the task then opens the full editor", async () => {
    render(<QuickAddModal projects={[]} userId="user-1" />);
    openViaEvent();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Buy milk" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    // The lightweight quick-add closed and the full editor took over.
    expect(screen.queryByLabelText("Quick add task")).toBeNull();
    expect(await screen.findByText(/auto-save/i)).toBeInTheDocument();
  });
});
