import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resolveQuickSchedule } from "@do-done/shared";
import { BulkActionBar } from "./bulk-action-bar";
import { SAMPLE_PROJECTS, makeTask } from "./__stories__/mocks";
import { TaskSelectionProvider, useTaskSelection } from "@/lib/task-selection";

const bulkUpdate = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: vi.fn(async () => ({ bulkUpdate })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/today",
}));

const IDS = ["task-a", "task-b", "task-c", "task-d"];

/** Stand-in task rows: clicking one toggles it into the selection. */
function Rows() {
  const selection = useTaskSelection();
  return (
    <>
      {IDS.map((id) => (
        <button
          key={id}
          data-task-row={id}
          onClick={() => {
            selection.registerTask(makeTask({ id }));
            selection.toggle(id);
          }}
        >
          row {id}
        </button>
      ))}
    </>
  );
}

/** Render the bar with all four rows selected. */
async function selectAll(user: ReturnType<typeof userEvent.setup>) {
  render(
    <TaskSelectionProvider>
      <Rows />
      <BulkActionBar projects={SAMPLE_PROJECTS} />
    </TaskSelectionProvider>
  );
  for (const id of IDS) await user.click(screen.getByText(`row ${id}`));
  expect(screen.getByText("4 selected")).toBeInTheDocument();
}

/** The patch every selected task received, asserting the batch covered all 4. */
function patchFromLastCall() {
  const updates = bulkUpdate.mock.calls.at(-1)?.[0] as Array<{
    id: string;
    input: Record<string, unknown>;
  }>;
  expect(updates.map((u) => u.id).sort()).toEqual([...IDS].sort());
  return updates[0].input;
}

// Every action below lives inside a popover, and all three popovers share one
// `menu` state. A closed sibling that closed *that* state on any outside
// mousedown unmounted the open popover before its item's click could land —
// so picking a project (or a date, or a priority) silently did nothing.
describe("BulkActionBar popover actions", () => {
  beforeEach(() => {
    bulkUpdate
      .mockReset()
      .mockResolvedValue({ data: [], error: null, failedIds: [] });
    refresh.mockReset();
  });

  it("moves every selected task into the picked project", async () => {
    const user = userEvent.setup();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: /move/i }));
    await user.click(
      screen.getByRole("menuitem", { name: SAMPLE_PROJECTS[1].name })
    );

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1));
    expect(patchFromLastCall()).toEqual({ project_id: SAMPLE_PROJECTS[1].id });
  });

  it("moves every selected task out of its project", async () => {
    const user = userEvent.setup();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: /move/i }));
    await user.click(screen.getByRole("menuitem", { name: "No project" }));

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1));
    expect(patchFromLastCall()).toEqual({ project_id: null });
  });

  it("schedules every selected task from a quick option", async () => {
    const user = userEvent.setup();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: /schedule/i }));
    await user.click(screen.getByRole("menuitem", { name: "Tomorrow" }));

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1));
    expect(patchFromLastCall()).toEqual({
      scheduled_date: resolveQuickSchedule("tomorrow"),
    });
  });

  it("clears the schedule on every selected task", async () => {
    const user = userEvent.setup();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: /schedule/i }));
    await user.click(screen.getByRole("menuitem", { name: /clear schedule/i }));

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1));
    expect(patchFromLastCall()).toEqual({
      scheduled_date: null,
      scheduled_time: null,
    });
  });

  it("sets the priority on every selected task", async () => {
    const user = userEvent.setup();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: /priority/i }));
    await user.click(screen.getByRole("menuitem", { name: /P1/ }));

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1));
    expect(patchFromLastCall()).toEqual({ priority: "p1" });
  });

  it("clears the selection and refreshes once the write lands", async () => {
    const user = userEvent.setup();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: /move/i }));
    await user.click(
      screen.getByRole("menuitem", { name: SAMPLE_PROJECTS[1].name })
    );

    // The bar unmounts with the selection, which is what dismisses the popover.
    await waitFor(() =>
      expect(screen.queryByText("4 selected")).not.toBeInTheDocument()
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("still closes the open popover on a click outside the bar", async () => {
    const user = userEvent.setup();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: /move/i }));
    expect(
      screen.getByRole("menu", { name: "Move" })
    ).toBeInTheDocument();

    await user.click(screen.getByText(`row ${IDS[0]}`));
    await waitFor(() =>
      expect(screen.queryByRole("menu", { name: "Move" })).not.toBeInTheDocument()
    );
  });
});
