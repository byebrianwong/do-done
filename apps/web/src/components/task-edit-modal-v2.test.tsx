import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TaskEditModalV2 } from "./task-edit-modal-v2";
import { makeTask } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Captured so individual tests can assert which field the pickers wrote.
// `subtasks` is mutable so a test can stock the subtask list the modal loads.
const { setFieldSpy, subtasks } = vi.hoisted(() => ({
  setFieldSpy: vi.fn(),
  subtasks: { current: [] as unknown[] },
}));

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
    status: "idle",
    lastError: null,
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
      return { data: subtasks.current };
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
  subtasks.current = [];
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

describe("Priority bars", () => {
  function renderAt(priority: "p1" | "p2" | "p3" | "p4") {
    render(
      <TaskEditModalV2 task={makeTask({ priority })} open onClose={vi.fn()} />
    );
  }

  it("clicking the priority the task already has clears it to p4", () => {
    renderAt("p2");
    fireEvent.click(screen.getByLabelText("Set priority High"));
    expect(setFieldSpy).toHaveBeenCalledWith("priority", "p4");
  });

  it("clicking a different bar sets that priority", () => {
    renderAt("p2");
    fireEvent.click(screen.getByLabelText("Set priority Urgent"));
    expect(setFieldSpy).toHaveBeenCalledWith("priority", "p1");
  });
});

describe("Deadline quick picks", () => {
  function openDeadlinePopover(): HTMLElement {
    render(
      <TaskEditModalV2
        task={makeTask({ scheduled_date: isoFromToday(0), deadline_date: null })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTitle("Set deadline"));
    return screen.getByRole("dialog", { name: "Deadline" });
  }

  it("offers the common deadlines plus a specific-date input", () => {
    const el = openDeadlinePopover();
    const dialog = within(el);
    // "Same as task date" only appears because the task has a scheduled_date.
    expect(dialog.getByText("Same as task date")).toBeInTheDocument();
    expect(dialog.getByText("Tomorrow")).toBeInTheDocument();
    expect(dialog.getByText("This weekend")).toBeInTheDocument();
    expect(dialog.getByText("Next week")).toBeInTheDocument();
    // The "specific date" escape hatch is still present below the quick picks.
    expect(dialog.getByText("or a specific date")).toBeInTheDocument();
    expect(el.querySelector('input[type="date"]')).not.toBeNull();
  });

  it("writes the resolved date when a quick pick is tapped", () => {
    const dialog = within(openDeadlinePopover());
    fireEvent.click(dialog.getByText("Tomorrow"));
    expect(setFieldSpy).toHaveBeenCalledWith("deadline_date", isoFromToday(1));
  });

  it("'Same as task date' mirrors the task's scheduled_date", () => {
    const dialog = within(openDeadlinePopover());
    fireEvent.click(dialog.getByText("Same as task date"));
    expect(setFieldSpy).toHaveBeenCalledWith("deadline_date", isoFromToday(0));
  });

  it("omits 'Same as task date' when the task has no scheduled_date", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ scheduled_date: null })}
        open
        onClose={vi.fn()}
      />
    );
    // No scheduled_date → no Time field and no "Same as task date" affordance, but
    // the deadline button still opens; the deadline field lives in the action row
    // regardless.
    fireEvent.click(screen.getByTitle("Set deadline"));
    const dialog = within(screen.getByRole("dialog", { name: "Deadline" }));
    expect(dialog.queryByText("Same as task date")).not.toBeInTheDocument();
    expect(dialog.getByText("Tomorrow")).toBeInTheDocument();
  });
});

describe("Do-time quick scroll", () => {
  function openTimePopover() {
    render(
      <TaskEditModalV2
        task={makeTask({ scheduled_date: isoFromToday(0), scheduled_time: null })}
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

  it("writes scheduled_time when a slot is tapped", () => {
    const dialog = openTimePopover();
    fireEvent.click(dialog.getByText("12:00 PM"));
    expect(setFieldSpy).toHaveBeenCalledWith("scheduled_time", "12:00");
  });

  it("reveals a native time input when 'Specific time' is expanded", () => {
    const dialog = openTimePopover();
    fireEvent.click(dialog.getByText(/Specific time/));
    const input = dialog.getByDisplayValue("") as HTMLInputElement;
    expect(input.type).toBe("time");
  });
});

describe("Notes", () => {
  it("renders URLs in saved notes as links", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ description: "Spec: https://example.com/spec" })}
        open
        onClose={vi.fn()}
      />
    );
    const link = screen.getByRole("link", { name: "https://example.com/spec" });
    expect(link).toHaveAttribute("href", "https://example.com/spec");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("swaps to the textarea when the notes are clicked", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ description: "Spec: https://example.com/spec" })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("textbox", { name: "Notes" }));
    expect(
      screen.getByDisplayValue("Spec: https://example.com/spec")
    ).toBeInTheDocument();
  });

  it("stays in the read view when a link inside it takes focus", () => {
    // focusin bubbles, so an unguarded onFocus on the box would unmount the
    // read view as the anchor focuses — killing the click that follows it.
    render(
      <TaskEditModalV2
        task={makeTask({ description: "Spec: https://example.com/spec" })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.focusIn(screen.getByRole("link"));
    expect(screen.queryByDisplayValue(/example\.com/)).toBeNull();
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("shows the textarea straight away when there are no notes", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ description: null })}
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText("Tap to add notes…")).toBeInTheDocument();
  });

  it("keeps line breaks in the read view", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ description: "one\ntwo" })}
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("textbox", { name: "Notes" }).className).toContain(
      "whitespace-pre-wrap"
    );
  });
});

describe("Subtask rows", () => {
  it("renders URLs in a subtask title as links", async () => {
    subtasks.current = [
      makeTask({ id: "sub-1", title: "Read https://example.com/rfc/42" }),
    ];
    render(<TaskEditModalV2 task={makeTask()} open onClose={vi.fn()} />);
    const link = await screen.findByRole("link", {
      name: "https://example.com/rfc/42",
    });
    expect(link).toHaveAttribute("href", "https://example.com/rfc/42");
    // An <a> inside a <button> is invalid HTML and browsers handle it
    // inconsistently — the title must not be a button any more.
    expect(link.closest("button")).toBeNull();
  });

  it("keeps a keyboard route to 'open' now that the title isn't a button", async () => {
    subtasks.current = [
      makeTask({ id: "sub-1", title: "Read https://example.com/rfc/42" }),
    ];
    render(<TaskEditModalV2 task={makeTask()} open onClose={vi.fn()} />);
    const open = await screen.findByRole("button", {
      name: "Open Read https://example.com/rfc/42",
    });
    // Hover-only reveal would strand keyboard users on an invisible control.
    expect(open.className).toContain("focus-visible:opacity-100");
  });
});
