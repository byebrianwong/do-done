import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { addDaysLocalISO } from "@do-done/shared";

// Assertions avoid jest-dom matchers (getByText/getByRole throw on miss, so they
// assert presence on their own) — this suite proves the Overdue "reschedule all"
// wiring without depending on matcher setup.

const bulkUpdate = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/supabase/tasks-client", () => ({
  getClientTasksApi: vi.fn(async () => ({ bulkUpdate })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/upcoming",
  useSearchParams: () => new URLSearchParams(),
}));

// Isolate the rows from the (heavy) edit modal subtree, whose api-client
// useAutoSaveTask hook otherwise drags a second React copy into the render and
// crashes jsdom — same guard task-item.test.tsx uses. Keep the module's other
// exports (selectors the rows import).
vi.mock("./task-edit-modal-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./task-edit-modal-v2")>()),
  TaskEditModalV2: () => null,
}));

import { DraggableUpcoming, NO_DATE_KEY, OVERDUE_KEY } from "./draggable-upcoming";
import { makeTask } from "./__stories__/mocks";

function renderWithOverdue() {
  const overdueWhen = makeTask({
    id: "od-when",
    title: "Overdue by when_date",
    when_date: addDaysLocalISO(-2),
  });
  const overdueDue = makeTask({
    id: "od-due",
    title: "Overdue by due_date",
    due_date: addDaysLocalISO(-3),
  });
  const groups = [
    { date: OVERDUE_KEY, label: "Overdue", tasks: [overdueWhen, overdueDue] },
    { date: NO_DATE_KEY, label: "No date", tasks: [] },
    { date: addDaysLocalISO(0), label: "Today", tasks: [] },
    { date: addDaysLocalISO(1), label: "Tomorrow", tasks: [] },
  ];
  render(<DraggableUpcoming groups={groups} />);
}

describe("DraggableUpcoming — Overdue reschedule all", () => {
  beforeEach(() => {
    bulkUpdate.mockReset().mockResolvedValue({ data: [], error: null });
    refresh.mockReset();
  });

  it("renders the reschedule-all toolbar in the Overdue header", () => {
    renderWithOverdue();
    screen.getByText("Reschedule all");
    screen.getByRole("button", { name: "Today" });
    screen.getByRole("button", { name: "Tomorrow" });
    screen.getByRole("button", { name: "Next week" });
  });

  it("moves every overdue task to the chosen day, sliding past due dates forward", async () => {
    renderWithOverdue();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalledTimes(1));
    const tomorrow = addDaysLocalISO(1);
    const updates = bulkUpdate.mock.calls[0][0] as Array<{
      id: string;
      input: Record<string, unknown>;
    }>;
    expect(updates).toHaveLength(2);
    // when_date-only overdue task: just moves its when_date.
    expect(updates.find((u) => u.id === "od-when")!.input).toEqual({
      when_date: tomorrow,
    });
    // due_date-driven overdue task: when_date set AND the past deadline slides up.
    expect(updates.find((u) => u.id === "od-due")!.input).toEqual({
      when_date: tomorrow,
      due_date: tomorrow,
    });
  });

  it("hides the Overdue group and refreshes once the reschedule lands", async () => {
    renderWithOverdue();
    screen.getByText("Reschedule all");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    await waitFor(() =>
      expect(screen.queryByText("Reschedule all")).toBeNull()
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the Overdue group visible when the bulk write fails", async () => {
    bulkUpdate.mockResolvedValue({ data: [], error: new Error("nope") });
    renderWithOverdue();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    await waitFor(() => expect(bulkUpdate).toHaveBeenCalled());
    // Group stays put; no refresh on failure.
    screen.getByText("Reschedule all");
    expect(refresh).not.toHaveBeenCalled();
  });
});
