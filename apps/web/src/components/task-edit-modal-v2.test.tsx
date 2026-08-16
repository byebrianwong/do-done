import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TASK_DESCRIPTION_MAX_LENGTH } from "@do-done/shared";
import { TaskEditModalV2 } from "./task-edit-modal-v2";
import { makeTask, SAMPLE_PROJECTS } from "./__stories__/mocks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Captured so individual tests can assert which field the pickers wrote.
// `subtasks` is mutable so a test can stock the subtask list the modal loads.
const { setFieldSpy, subtasks, saveState, retrySpy } = vi.hoisted(() => ({
  setFieldSpy: vi.fn(),
  subtasks: { current: [] as unknown[] },
  retrySpy: vi.fn(),
  // What the autosave hook reports back. Mutable so a test can put the editor
  // into a failed-save state without a backend.
  saveState: {
    current: {
      status: "idle" as string,
      lastError: null as Error | null,
      fieldErrors: {} as Record<string, string>,
      hasUnsavedWork: false,
    },
  },
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
    retry: retrySpy,
    ...saveState.current,
  }),
  // The editor's Places section loads its own links; an empty set keeps it
  // out of the way of what these tests are actually about.
  LocationsApi: class {
    async getTaskLocations() {
      return { data: [], error: null };
    }
    async list() {
      return { data: [], error: null };
    }
  },
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
  retrySpy.mockClear();
  subtasks.current = [];
  saveState.current = {
    status: "idle",
    lastError: null,
    fieldErrors: {},
    hasUnsavedWork: false,
  };
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

describe("Priority", () => {
  // Two controls write this column — the stripe along the modal's top edge and
  // the word on the cover — and both open the same list of named ranks. The
  // list replaced a four-bar meter whose failure modes these now guard
  // against: a click landing in the gap between columns, and a click on the
  // rank the task already had being read as "clear".
  function openPriorityList(
    priority: "p1" | "p2" | "p3" | "p4",
    from: "stripe" | "word" = "word"
  ) {
    render(
      <TaskEditModalV2 task={makeTask({ priority })} open onClose={vi.fn()} />
    );
    const label = { p1: "Urgent", p2: "High", p3: "Medium", p4: "Low" }[
      priority
    ];
    const controls = screen.getAllByLabelText(`Priority: ${label}`);
    // The stripe is first in the DOM, the cover word last.
    fireEvent.click(from === "stripe" ? controls[0] : controls.at(-1)!);
    return within(screen.getByRole("listbox", { name: "Priority options" }));
  }

  it("the stripe and the cover word both report the current priority", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ priority: "p1" })}
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getAllByLabelText("Priority: Urgent")).toHaveLength(2);
  });

  it("names the rank on the cover below High too, not only the loud two", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ priority: "p4" })}
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Low priority")).toBeInTheDocument();
  });

  it("picking a different rank writes it", () => {
    const list = openPriorityList("p2");
    fireEvent.click(list.getByText("Urgent"));
    expect(setFieldSpy).toHaveBeenCalledWith("priority", "p1");
  });

  it("the stripe opens the same list", () => {
    const list = openPriorityList("p2", "stripe");
    fireEvent.click(list.getByText("Medium"));
    expect(setFieldSpy).toHaveBeenCalledWith("priority", "p3");
  });

  it("re-picking the rank the task already has leaves it there", () => {
    // The meter read that click as "clear to p4", so confirming an Urgent task
    // was Urgent silently demoted it to Low.
    const list = openPriorityList("p2");
    fireEvent.click(list.getByText("High"));
    expect(setFieldSpy).toHaveBeenCalledWith("priority", "p2");
  });
});

describe("Estimate rail", () => {
  function openRail(minutes: number | null) {
    render(
      <TaskEditModalV2
        task={makeTask({ duration_minutes: minutes })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByLabelText(minutes ? /^Estimate: / : "Set an estimate")
    );
    return within(screen.getByRole("listbox", { name: "Estimate options" }));
  }

  it("names the estimate it's showing, and says so when there isn't one", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ duration_minutes: 120 })}
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Estimate: 2h")).toBeInTheDocument();
  });

  it("picking a bucket writes it", () => {
    const list = openRail(null);
    fireEvent.click(list.getByText("~2 hr"));
    expect(setFieldSpy).toHaveBeenCalledWith("duration_minutes", 120);
  });

  it("clearing is a row of its own", () => {
    // It used to be "click the bucket that's already lit", which is
    // indistinguishable from re-confirming it.
    const list = openRail(120);
    fireEvent.click(list.getByText("No estimate"));
    expect(setFieldSpy).toHaveBeenCalledWith("duration_minutes", null);
  });

  it("offers no clear row when there is nothing to clear", () => {
    const list = openRail(null);
    expect(list.queryByText("No estimate")).toBeNull();
  });
});

describe("Status", () => {
  it("sits on the title's line rather than in a band of its own", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ status: "in_progress" })}
        open
        onClose={vi.fn()}
      />
    );
    // The caps "STATUS" caption went with the band; the chip names the value.
    expect(screen.queryByText("Status")).toBeNull();
    fireEvent.click(screen.getByLabelText("Status: In progress"));
    const list = within(
      screen.getByRole("listbox", { name: "Status options" })
    );
    fireEvent.click(list.getByText("Done"));
    expect(setFieldSpy).toHaveBeenCalledWith("status", "done");
  });
});

describe("The row under the calendar", () => {
  function renderScheduled(scheduled_date: string | null) {
    render(
      <TaskEditModalV2
        task={makeTask({ scheduled_date, scheduled_time: null })}
        open
        onClose={vi.fn()}
      />
    );
  }

  it("is see-more-dates, a time, and a deadline — no 'Next week' quick pick", () => {
    renderScheduled(isoFromToday(0));
    expect(screen.getByText("See more dates ⇣")).toBeInTheDocument();
    expect(screen.getByText("Add time")).toBeInTheDocument();
    expect(screen.getByText("Deadline")).toBeInTheDocument();
    // The date it offered is a cell in the grid above, labelled "next wk".
    expect(screen.queryByText("Next week")).toBeNull();
  });

  it("offers a time only once there's a day to hang it off", () => {
    renderScheduled(null);
    expect(screen.queryByText("Add time")).toBeNull();
  });
});

describe("Project cover", () => {
  it("offers a way to file an unfiled task rather than hiding the banner", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ project_id: null })}
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Set project")).toBeInTheDocument();
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
  it("caps the notes at the length the DB will accept", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ description: null })}
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText("Tap to add notes…")).toHaveAttribute(
      "maxlength",
      String(TASK_DESCRIPTION_MAX_LENGTH)
    );
  });

  it("stays quiet about the limit until it's actually in reach", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ description: null })}
        open
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText(/characters left/)).toBeNull();
  });

  it("counts down as the notes approach the limit", () => {
    render(
      <TaskEditModalV2
        task={makeTask({
          description: "x".repeat(TASK_DESCRIPTION_MAX_LENGTH - 500),
        })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("textbox", { name: "Notes" }));
    expect(screen.getByText("500 characters left")).toBeInTheDocument();
  });

  it("says so plainly once the notes are full, rather than just going silent", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ description: "x".repeat(TASK_DESCRIPTION_MAX_LENGTH) })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("textbox", { name: "Notes" }));
    expect(screen.getByText("Notes are full")).toBeInTheDocument();
  });

  // `maxLength` bounds typing and pasting but never truncates a value handed in
  // as a prop, so an already-oversized row must read "full" rather than count
  // down into negatives.
  it("doesn't count past zero on notes that are already over the limit", () => {
    render(
      <TaskEditModalV2
        task={makeTask({
          description: "x".repeat(TASK_DESCRIPTION_MAX_LENGTH + 40),
        })}
        open
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("textbox", { name: "Notes" }));
    expect(screen.getByText("Notes are full")).toBeInTheDocument();
    expect(screen.queryByText(/-\d+ characters left/)).toBeNull();
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

describe("Title `#token` shortcuts", () => {
  function typeTitle(value: string) {
    render(<TaskEditModalV2 task={makeTask({ title: "" })} open onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("Task title or /command…");
    fireEvent.change(input, { target: { value } });
    return input;
  }

  it("absorbs a space-terminated #xs into the estimate", () => {
    typeTitle("buy toothpaste #xs ");
    expect(setFieldSpy).toHaveBeenCalledWith("duration_minutes", 30);
    expect(setFieldSpy).toHaveBeenCalledWith("title", "buy toothpaste");
  });

  it("leaves a partial #token alone while the user is still typing", () => {
    // `#x` must not be absorbed on the way to `#xs`.
    typeTitle("buy toothpaste #x");
    expect(setFieldSpy).toHaveBeenCalledWith("title", "buy toothpaste #x");
    expect(setFieldSpy).not.toHaveBeenCalledWith("duration_minutes", 30);
  });

  it("absorbs a trailing #xs on blur, with no trailing space", () => {
    // The reported bug: typing "buy toothpaste #xs" and stopping left the
    // token in the title verbatim, because a space was the only terminator.
    const input = typeTitle("buy toothpaste #xs");
    setFieldSpy.mockClear();
    fireEvent.blur(input, { target: { value: "buy toothpaste #xs" } });
    expect(setFieldSpy).toHaveBeenCalledWith("duration_minutes", 30);
    expect(setFieldSpy).toHaveBeenCalledWith("title", "buy toothpaste");
  });

  it("absorbs a trailing #p1 on Enter as a priority, not a tag", () => {
    const input = typeTitle("ship widget #p1");
    setFieldSpy.mockClear();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(setFieldSpy).toHaveBeenCalledWith("priority", "p1");
    expect(setFieldSpy).toHaveBeenCalledWith("title", "ship widget");
    expect(setFieldSpy).not.toHaveBeenCalledWith("tags", ["p1"]);
  });

  it("absorbs a trailing #tag on blur", () => {
    const input = typeTitle("email bob #work");
    setFieldSpy.mockClear();
    fireEvent.blur(input, { target: { value: "email bob #work" } });
    expect(setFieldSpy).toHaveBeenCalledWith("tags", ["work"]);
    expect(setFieldSpy).toHaveBeenCalledWith("title", "email bob");
  });

  it("files a #token naming one of the modal's projects, instead of tagging it", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ title: "" })}
        open
        onClose={vi.fn()}
        projects={SAMPLE_PROJECTS}
      />
    );
    const input = screen.getByPlaceholderText("Task title or /command…");
    fireEvent.change(input, { target: { value: "email bob #engineering " } });
    expect(setFieldSpy).toHaveBeenCalledWith("project_id", "proj-1");
    expect(setFieldSpy).not.toHaveBeenCalledWith("tags", ["engineering"]);
    expect(setFieldSpy).toHaveBeenCalledWith("title", "email bob");
  });

  it("still tags a #token that names no project", () => {
    render(
      <TaskEditModalV2
        task={makeTask({ title: "" })}
        open
        onClose={vi.fn()}
        projects={SAMPLE_PROJECTS}
      />
    );
    const input = screen.getByPlaceholderText("Task title or /command…");
    fireEvent.change(input, { target: { value: "email bob #work " } });
    expect(setFieldSpy).toHaveBeenCalledWith("tags", ["work"]);
  });

  describe("the + tag control reads its token the same way the title does", () => {
    function addViaButton(token: string) {
      render(
        <TaskEditModalV2
          task={makeTask({ title: "" })}
          open
          onClose={vi.fn()}
          projects={SAMPLE_PROJECTS}
        />
      );
      fireEvent.click(screen.getByText("+ tag"));
      const input = screen.getByLabelText("New tag");
      fireEvent.change(input, { target: { value: token } });
      setFieldSpy.mockClear();
      fireEvent.keyDown(input, { key: "Enter" });
    }

    it("files the task when the tag names a project", () => {
      // The reported bug: `#personal` typed in the title filed the task, while
      // the same word typed into the tag field two inches away made a tag of it.
      addViaButton("personal");
      expect(setFieldSpy).toHaveBeenCalledWith("project_id", "proj-2");
      expect(setFieldSpy).not.toHaveBeenCalledWith("tags", ["personal"]);
    });

    it("sets the priority from its code", () => {
      addViaButton("p1");
      expect(setFieldSpy).toHaveBeenCalledWith("priority", "p1");
    });

    it("sets the estimate from its size code", () => {
      addViaButton("xs");
      expect(setFieldSpy).toHaveBeenCalledWith("duration_minutes", 30);
    });

    it("still tags a word that names nothing", () => {
      addViaButton("work");
      expect(setFieldSpy).toHaveBeenCalledWith("tags", ["work"]);
    });
  });

  it("absorbs a trailing token when Esc closes the modal", async () => {
    // Esc unmounts the input, and React fires no `onBlur` on unmount — so the
    // close path has to absorb too, or the token is saved into the title.
    const onClose = vi.fn();
    render(<TaskEditModalV2 task={makeTask({ title: "" })} open onClose={onClose} />);
    const input = screen.getByPlaceholderText("Task title or /command…");
    fireEvent.change(input, { target: { value: "buy toothpaste #xs" } });
    setFieldSpy.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(setFieldSpy).toHaveBeenCalledWith("duration_minutes", 30);
    expect(setFieldSpy).toHaveBeenCalledWith("title", "buy toothpaste");
  });
});

describe("Title blur does not dirty an untouched task", () => {
  it("writes nothing when the title is blurred unchanged", () => {
    // The blur/Enter/close flush runs on every focus loss. Writing
    // unconditionally marked a task the user never edited as dirty, which
    // flipped the header's save indicator, fired a pointless PATCH, and made
    // `hasChanges` true so an abandoned draft stopped being cleaned up.
    render(
      <TaskEditModalV2
        task={makeTask({ title: "Archive the Q3 board" })}
        open
        onClose={vi.fn()}
      />
    );
    const input = screen.getByPlaceholderText("Task title or /command…");
    setFieldSpy.mockClear();
    fireEvent.blur(input, { target: { value: "Archive the Q3 board" } });
    expect(setFieldSpy).not.toHaveBeenCalled();
  });

  it("still writes when the title actually changed", () => {
    render(
      <TaskEditModalV2 task={makeTask({ title: "old" })} open onClose={vi.fn()} />
    );
    const input = screen.getByPlaceholderText("Task title or /command…");
    fireEvent.change(input, { target: { value: "new" } });
    expect(setFieldSpy).toHaveBeenCalledWith("title", "new");
  });

  it("does not dirty the task when Esc closes it untouched", () => {
    render(
      <TaskEditModalV2 task={makeTask({ title: "untouched" })} open onClose={vi.fn()} />
    );
    setFieldSpy.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(setFieldSpy).not.toHaveBeenCalled();
  });
});

describe("Failed saves", () => {
  const failed = (message: string) => {
    saveState.current = {
      status: "error",
      lastError: new Error(message),
      fieldErrors: {},
      hasUnsavedWork: true,
    };
  };

  it("states the reason in the modal itself, not only in a tooltip", () => {
    failed("Notes is too long — 50,000 characters max.");
    render(<TaskEditModalV2 task={makeTask()} open onClose={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Notes is too long");
  });

  it("offers a retry that doesn't depend on typing again", () => {
    failed("Save failed");
    render(<TaskEditModalV2 task={makeTask()} open onClose={vi.fn()} />);

    fireEvent.click(within(screen.getByRole("alert")).getByText("Retry"));
    expect(retrySpy).toHaveBeenCalled();
  });

  it("says nothing when there's nothing wrong", () => {
    render(<TaskEditModalV2 task={makeTask()} open onClose={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks the field the failure is about", () => {
    saveState.current = {
      status: "error",
      lastError: new Error("Notes is too long — 50,000 characters max."),
      fieldErrors: { description: "Notes is too long — 50,000 characters max." },
      hasUnsavedWork: true,
    };
    render(
      <TaskEditModalV2
        task={makeTask({ description: "some notes" })}
        open
        onClose={vi.fn()}
      />
    );
    // Once in the banner, once against the Notes field itself.
    expect(screen.getAllByText(/Notes is too long/)).toHaveLength(2);
  });

  it("won't let the editor close over an edit the server never took", () => {
    const onClose = vi.fn();
    failed("Save failed");
    render(<TaskEditModalV2 task={makeTask()} open onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("closes anyway when the user says so", () => {
    const onClose = vi.fn();
    failed("Save failed");
    render(<TaskEditModalV2 task={makeTask()} open onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByText("Close anyway"));

    expect(onClose).toHaveBeenCalled();
  });

  it("retries from the prompt instead of losing the edit", () => {
    failed("Save failed");
    render(<TaskEditModalV2 task={makeTask()} open onClose={vi.fn()} />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByText("Retry save"));
    expect(retrySpy).toHaveBeenCalled();
  });

  it("keeps Esc from escaping the very guard it triggered", () => {
    const onClose = vi.fn();
    failed("Save failed");
    render(<TaskEditModalV2 task={makeTask()} open onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    // A second Esc backs out of the prompt rather than dismissing the editor.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes without ceremony when the save is merely queued", () => {
    // `flushOnExit` persists a pending save, so prompting here would fire on
    // every close inside the 250ms debounce window.
    const onClose = vi.fn();
    saveState.current = {
      status: "pending",
      lastError: null,
      fieldErrors: {},
      hasUnsavedWork: true,
    };
    render(<TaskEditModalV2 task={makeTask()} open onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
