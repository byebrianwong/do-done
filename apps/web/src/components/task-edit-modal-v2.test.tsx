import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskEditModalV2 } from "./task-edit-modal-v2";
import { makeTask } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The modal autosaves and loads calendar busyness; stub the data layer so we
// can assert its responsive container without a backend.
vi.mock("@do-done/api-client", () => ({
  useAutoSaveTask: (task: unknown) => ({
    task,
    setField: vi.fn(),
    undoAll: vi.fn(),
    hasChanges: false,
    lastSavedAt: null,
    isSaving: false,
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
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ days: [] }),
    }))
  );
});

function getCard(container: HTMLElement): HTMLElement {
  // The card is the inner panel (child of the fixed overlay).
  const overlay = container.firstElementChild as HTMLElement;
  return overlay.firstElementChild as HTMLElement;
}

describe("TaskEditModalV2 — fits and scrolls on small screens", () => {
  it("caps the modal height to the viewport and lays it out as a flex column", () => {
    const { container } = render(
      <TaskEditModalV2 task={makeTask()} open onClose={vi.fn()} />
    );
    const card = getCard(container);
    expect(card.className).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(card.className).toContain("flex-col");
  });

  it("makes the body scrollable so long content isn't cut off on a phone", () => {
    const { container } = render(
      <TaskEditModalV2 task={makeTask()} open onClose={vi.fn()} />
    );
    expect(container.innerHTML).toContain("overflow-y-auto");
  });

  it("renders the editable title input (core functionality)", () => {
    render(<TaskEditModalV2 task={makeTask({ title: "Edit me" })} open onClose={vi.fn()} />);
    expect(
      screen.getByPlaceholderText(/Task title or \/command/i)
    ).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <TaskEditModalV2 task={makeTask()} open={false} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
