import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "@do-done/shared";
import { TaskDisplayView } from "@/components/task-display-view";
import { makeTask } from "@/components/__stories__/mocks";
import {
  TaskEditingHoldProvider,
  useHoldWhileEditing,
  useTasksHeldForEditing,
} from "./task-editing-hold";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Stand in for the (heavy) editor with something that only says whether it's
// open and offers a way to close — this suite is about what happens to the row
// underneath it, not the editor's contents. The rest of the module's exports
// are kept: the row's inline editors import helpers from it.
vi.mock("@/components/task-edit-modal-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/task-edit-modal-v2")>()),
  TaskEditModalV2: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div>
        <span>editor open</span>
        <button onClick={onClose}>close editor</button>
      </div>
    ) : null,
}));

// The grouped list is loaded with `next/dynamic`, so the rows arrive a tick
// after the first paint.
async function openEditorOn(title: string) {
  const row = (await screen.findByText(title)).closest(
    "[data-task-row]"
  ) as HTMLElement;
  fireEvent.click(row);
}

describe("a task whose editor is open holds its row", () => {
  // The editor auto-saves and refreshes the server components, so changing
  // Status in the Inbox drops the task from the view's query mid-edit. The row
  // renders the editor, so unmounting it shut the editor on the first change.
  it("keeps the row, and the editor, after a save takes the task out of the view", async () => {
    const stays = makeTask({ title: "Still an inbox task", status: "inbox" });
    const edited = makeTask({ title: "Reclassify me", status: "inbox" });

    const { rerender } = render(
      <TaskEditingHoldProvider>
        <TaskDisplayView viewKey="inbox-test" tasks={[stays, edited]} />
      </TaskEditingHoldProvider>
    );

    await openEditorOn("Reclassify me");
    expect(screen.getByText("editor open")).toBeInTheDocument();

    // The save lands: the server's Inbox no longer includes the task.
    rerender(
      <TaskEditingHoldProvider>
        <TaskDisplayView viewKey="inbox-test" tasks={[stays]} />
      </TaskEditingHoldProvider>
    );

    expect(screen.getByText("Reclassify me")).toBeInTheDocument();
    expect(screen.getByText("editor open")).toBeInTheDocument();
  });

  it("lets the task leave the view once the editor closes", async () => {
    const stays = makeTask({ title: "Still an inbox task", status: "inbox" });
    const edited = makeTask({ title: "Reclassify me", status: "inbox" });

    const { rerender } = render(
      <TaskEditingHoldProvider>
        <TaskDisplayView viewKey="inbox-test" tasks={[stays, edited]} />
      </TaskEditingHoldProvider>
    );

    await openEditorOn("Reclassify me");
    rerender(
      <TaskEditingHoldProvider>
        <TaskDisplayView viewKey="inbox-test" tasks={[stays]} />
      </TaskEditingHoldProvider>
    );

    fireEvent.click(screen.getByText("close editor"));

    expect(screen.queryByText("Reclassify me")).not.toBeInTheDocument();
    expect(screen.getByText("Still an inbox task")).toBeInTheDocument();
  });

  it("keeps the row where it was, showing the task as the editor found it", async () => {
    const edited = makeTask({ title: "Reclassify me", status: "inbox" });
    const last = makeTask({ title: "Last task", status: "inbox" });

    const { rerender } = render(
      <TaskEditingHoldProvider>
        <TaskDisplayView viewKey="inbox-test" tasks={[edited, last]} />
      </TaskEditingHoldProvider>
    );

    await openEditorOn("Reclassify me");
    rerender(
      <TaskEditingHoldProvider>
        <TaskDisplayView viewKey="inbox-test" tasks={[last]} />
      </TaskEditingHoldProvider>
    );

    const titles = screen
      .getAllByText(/Reclassify me|Last task/)
      .map((el) => el.textContent);
    expect(titles).toEqual(["Reclassify me", "Last task"]);
    // Held as it was opened, so nothing regroups or re-sorts behind the modal:
    // an Inbox task still reads as one, with no status pill.
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });
});

describe("useTasksHeldForEditing", () => {
  function Holder({ task, editing }: { task: Task; editing: boolean }) {
    useHoldWhileEditing(task, editing);
    return null;
  }

  function List({ label, tasks }: { label: string; tasks: Task[] }) {
    const visible = useTasksHeldForEditing(tasks);
    return (
      <div>
        {visible.map((t) => (
          <span key={t.id}>{`${label}:${t.title}`}</span>
        ))}
      </div>
    );
  }

  // The registry is app-wide, so a view that never showed the task — the two
  // can be mounted together across a route transition — must not adopt it.
  it("only holds a row the list was already showing", () => {
    const held = makeTask({ title: "Held" });

    // Editor open on a row only "mine" is showing…
    const { rerender } = render(
      <TaskEditingHoldProvider>
        <List label="mine" tasks={[held]} />
        <List label="theirs" tasks={[]} />
        <Holder task={held} editing={true} />
      </TaskEditingHoldProvider>
    );

    // …then the save drops it from both queries.
    rerender(
      <TaskEditingHoldProvider>
        <List label="mine" tasks={[]} />
        <List label="theirs" tasks={[]} />
        <Holder task={held} editing={true} />
      </TaskEditingHoldProvider>
    );

    expect(screen.getByText("mine:Held")).toBeInTheDocument();
    expect(screen.queryByText("theirs:Held")).not.toBeInTheDocument();
  });
});
