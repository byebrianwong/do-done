import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuickAddModal } from "./quick-add-modal";
import { OPEN_QUICK_ADD_EVENT } from "@/lib/quick-add-events";
import { QuickAddProvider } from "@/lib/quick-add-context";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";
import type { CreateTaskInput, Task } from "@do-done/shared";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const createdTask = makeTask({ id: "new-1", title: "Buy milk", user_id: "user-1" });
// Typed on its input so a test can inspect what quick-add actually sent.
const createMock = vi.fn<
  (input: CreateTaskInput) => Promise<{ data: Task; error: null }>
>(async () => ({ data: createdTask, error: null }));

// The submit path goes through getClientTasksApi; stub it so we don't need a
// real Supabase session (the shared mock's getUser() resolves to null).
// `getTasksApiFor` is the same seam, synchronous — the editor the handoff
// opens builds its API through it.
vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: async () => ({ create: createMock }),
  getTasksApiFor: () => ({
    create: createMock,
    async getById() {
      return { data: null, error: null };
    },
    async listSubtasks() {
      return { data: [] };
    },
    async update() {
      return { data: null, error: null };
    },
    async delete() {
      return { error: null };
    },
  }),
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
    fieldErrors: {},
    hasUnsavedWork: false,
    retry: vi.fn(),
  }),
  // The editor's attachments section loads its own rows; an empty list keeps
  // it out of the way of what these tests are actually about.
  AttachmentsApi: class {
    async list() {
      return { data: [], error: null };
    }
    async signedUrls() {
      return { data: new Map<string, string>(), error: null };
    }
  },
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

describe("QuickAddModal — typing #project", () => {
  // The parse gets its project list from QuickAddProvider, not from the modal's
  // own prop, so the wiring only holds inside the provider the app layout mounts.
  function renderInProvider() {
    render(
      <QuickAddProvider projects={SAMPLE_PROJECTS} userId="user-1">
        <QuickAddModal projects={SAMPLE_PROJECTS} userId="user-1" />
      </QuickAddProvider>
    );
    openViaEvent();
    return screen.getByLabelText("Task title");
  }

  it("previews the matched project instead of a tag", () => {
    const input = renderInProvider();
    fireEvent.change(input, { target: { value: "buy milk #engineering" } });
    expect(screen.getByText("#Engineering")).toBeInTheDocument();
  });

  it("creates the task in that project, with the token out of the title", async () => {
    const input = renderInProvider();
    fireEvent.change(input, { target: { value: "buy milk #engineering" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add task$/i }));
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "buy milk", project_id: "proj-1" })
    );
    expect(createMock.mock.calls[0][0]).not.toHaveProperty("tags");
  });

  it("still tags a token naming no project", async () => {
    const input = renderInProvider();
    fireEvent.change(input, { target: { value: "buy milk #errands" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add task$/i }));
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "buy milk", tags: ["errands"] })
    );
    expect(createMock.mock.calls[0][0]).not.toHaveProperty("project_id");
  });
});
