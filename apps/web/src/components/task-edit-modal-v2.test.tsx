import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TaskEditModalV2 } from "./task-edit-modal-v2";
import { makeTask } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Captured so individual tests can assert which field the pickers wrote.
const { setFieldSpy } = vi.hoisted(() => ({ setFieldSpy: vi.fn() }));

// The modal autosaves and loads calendar busyness; stub the data layer so we
// can assert its responsive container without a backend.
vi.mock("@do-done/api-client", () => ({
  useAutoSaveTask: (task: unknown) => ({
    task,
    setField: setFieldSpy,
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
  setFieldSpy.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ days: [] }),
    }))
  );
});

// Local YYYY-MM-DD `days` from today — mirrors the component's own date math.
function isoFromToday(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

describe("Due-date quick picks", () => {
  function openDuePopover(): HTMLElement {
    render(
      <TaskEditModalV2
        task={makeTask({ when_date: isoFromToday(0), due_date: null })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTitle("Set due date"));
    return screen.getByRole("dialog", { name: "Due date" });
  }

  it("offers the common deadlines plus a specific-date input", () => {
    const el = openDuePopover();
    const dialog = within(el);
    // "Same as task date" only appears because the task has a when_date.
    expect(dialog.getByText("Same as task date")).toBeInTheDocument();
    expect(dialog.getByText("Tomorrow")).toBeInTheDocument();
    expect(dialog.getByText("This weekend")).toBeInTheDocument();
    expect(dialog.getByText("Next week")).toBeInTheDocument();
    // The "specific date" escape hatch is still present below the quick picks.
    expect(dialog.getByText("or a specific date")).toBeInTheDocument();
    expect(el.querySelector('input[type="date"]')).not.toBeNull();
  });

  it("writes the resolved date when a quick pick is tapped", () => {
    const dialog = within(openDuePopover());
    fireEvent.click(dialog.getByText("Tomorrow"));
    expect(setFieldSpy).toHaveBeenCalledWith("due_date", isoFromToday(1));
  });

  it("'Same as task date' mirrors the task's when_date", () => {
    const dialog = within(openDuePopover());
    fireEvent.click(dialog.getByText("Same as task date"));
    expect(setFieldSpy).toHaveBeenCalledWith("due_date", isoFromToday(0));
  });

  it("omits 'Same as task date' when the task has no when_date", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ when_bucket: "later", when_date: null })}
        open
        onClose={vi.fn()}
      />
    );
    // No when_date → no Time field and no due popover affordance for it, but
    // the due button still opens; bucket tasks have no calendar, so the due
    // field lives in the action row regardless.
    fireEvent.click(screen.getByTitle("Set due date"));
    const dialog = within(screen.getByRole("dialog", { name: "Due date" }));
    expect(dialog.queryByText("Same as task date")).not.toBeInTheDocument();
    expect(dialog.getByText("Tomorrow")).toBeInTheDocument();
  });
});

describe("Do-time quick scroll", () => {
  function openTimePopover() {
    render(
      <TaskEditModalV2
        task={makeTask({ when_date: isoFromToday(0), when_time: null })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTitle("Set a time"));
    return within(screen.getByRole("dialog", { name: "Do time" }));
  }

  it("shows half-hour slots and a hidden precise-time escape hatch", () => {
    const dialog = openTimePopover();
    // A couple of half-hour slots that always exist.
    expect(dialog.getByText("12:00 PM")).toBeInTheDocument();
    expect(dialog.getByText("9:30 AM")).toBeInTheDocument();
    // The precise input is collapsed behind a toggle.
    expect(dialog.getByText(/Specific time/)).toBeInTheDocument();
    expect(dialog.queryByDisplayValue("")).toBeNull();
  });

  it("writes when_time when a slot is tapped", () => {
    const dialog = openTimePopover();
    fireEvent.click(dialog.getByText("12:00 PM"));
    expect(setFieldSpy).toHaveBeenCalledWith("when_time", "12:00");
  });

  it("reveals a native time input when 'Specific time' is expanded", () => {
    const dialog = openTimePopover();
    fireEvent.click(dialog.getByText(/Specific time/));
    const input = dialog.getByDisplayValue("") as HTMLInputElement;
    expect(input.type).toBe("time");
  });
});
