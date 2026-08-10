import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { addDaysLocalISO } from "@do-done/shared";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";

/**
 * What a cross-day drop *writes*, given what the drag previewed.
 *
 * dnd-kit is stubbed down to the handlers so a drag can be played out as the
 * three calls it really is — start, over, end — with the geometry stated
 * rather than simulated. jsdom has no layout, so a real DndContext here would
 * collide against zero-sized rects and never reach these code paths at all.
 */
interface RowPatch {
  id: string;
  input: { sort_order?: number; scheduled_date?: string | null };
}

const bulkUpdate = vi.fn<
  (updates: RowPatch[]) => Promise<{
    data: never[];
    error: null;
    failedIds: string[];
  }>
>(async () => ({ data: [], error: null, failedIds: [] }));
const refresh = vi.fn();

let handlers: {
  onDragStart?: (e: DragStartEvent) => void;
  onDragOver?: (e: DragOverEvent) => void;
  onDragEnd?: (e: DragEndEvent) => void | Promise<void>;
} = {};

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragStart,
    onDragOver,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragStart?: (e: DragStartEvent) => void;
    onDragOver?: (e: DragOverEvent) => void;
    onDragEnd?: (e: DragEndEvent) => void;
  }) => {
    handlers = { onDragStart, onDragOver, onDragEnd };
    return <>{children}</>;
  },
  DragOverlay: () => null,
  defaultDropAnimationSideEffects: () => ({}),
  useSensor: () => ({}),
  useSensors: (...s: unknown[]) => s,
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  closestCorners: () => [],
}));

// Extends MouseSensor/TouchSensor, which the mock above doesn't provide.
vi.mock("@/lib/dnd-sensors", () => ({
  ModalAwareMouseSensor: {},
  ModalAwareTouchSensor: {},
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  arrayMove: <T,>(arr: T[], from: number, to: number) => {
    const next = [...arr];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  },
  verticalListSortingStrategy: {},
}));

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

// Same isolation the sibling suite uses: the edit modal drags a second React
// copy into the render through api-client's hooks.
vi.mock("./task-edit-modal-v2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./task-edit-modal-v2")>()),
  TaskEditModalV2: () => null,
}));

import { DraggableUpcoming, NO_DATE_KEY } from "./draggable-upcoming";
import { makeTask } from "./__stories__/mocks";

const TODAY = addDaysLocalISO(0);
const TOMORROW = addDaysLocalISO(1);

/** Today holds three rows; tomorrow holds the one about to be dragged. */
function renderTwoDays() {
  const today = ["a", "b", "c"].map((id) =>
    makeTask({ id, title: id.toUpperCase(), scheduled_date: TODAY })
  );
  const moved = makeTask({ id: "x", title: "X", scheduled_date: TOMORROW });
  render(
    <DraggableUpcoming
      groups={[
        { date: NO_DATE_KEY, label: "No date", tasks: [] },
        { date: TODAY, label: "Today", tasks: today },
        { date: TOMORROW, label: "Tomorrow", tasks: [moved] },
      ]}
    />
  );
}

/** A row the pointer is over, positioned so the dragged row's top clears its
 *  bottom — dnd-kit's "below" test, and how a drop lands *after* a row. */
function overRow(id: string) {
  return {
    id,
    rect: { top: 100, height: 40, bottom: 140, left: 0, width: 300, right: 300 },
  };
}

const activeBelow = {
  id: "x",
  rect: { current: { translated: { top: 200 } } },
};

/**
 * Play a whole drag: pick up, cross into `over`, drop on it. Each step goes
 * through `act` because the handler that runs the next one is re-created on
 * the render its predecessor's setState causes — which is also the order the
 * browser does it in, a frame apart.
 */
async function dragOnto(over: { id: string; rect: unknown }) {
  await act(async () => {
    handlers.onDragStart!({ active: { id: "x" } } as unknown as DragStartEvent);
  });
  await act(async () => {
    handlers.onDragOver!({
      active: activeBelow,
      over,
    } as unknown as DragOverEvent);
  });
  await act(async () => {
    await handlers.onDragEnd!({
      active: activeBelow,
      over,
    } as unknown as DragEndEvent);
  });
}

function ordersFrom(): RowPatch[] {
  expect(bulkUpdate).toHaveBeenCalledTimes(1);
  return bulkUpdate.mock.calls[0][0];
}

describe("DraggableUpcoming — what a cross-day drop writes", () => {
  beforeEach(() => {
    bulkUpdate.mockClear();
    refresh.mockClear();
    handlers = {};
  });

  it("writes the order the drag previewed, not one re-derived from the drop", async () => {
    renderTwoDays();
    // Crossing into Today under its last row places X at the bottom — that is
    // the preview the user is looking at when they let go. The drop then
    // reports a row as `over`, and re-deriving the position from it used to
    // move X back up a slot: dropped at the bottom, second from the bottom a
    // moment later.
    await dragOnto(overRow("c"));

    const updates = ordersFrom();
    expect(updates.map((u) => u.id)).toEqual(["a", "b", "c", "x"]);
    expect(updates.map((u) => u.input.sort_order)).toEqual([
      1000, 2000, 3000, 4000,
    ]);
  });

  it("patches the moved row once, with its new day and its new place together", async () => {
    renderTwoDays();
    await dragOnto(overRow("c"));

    const updates = ordersFrom();
    const forX = updates.filter((u) => u.id === "x");
    expect(forX).toHaveLength(1);
    expect(forX[0].input).toEqual({ scheduled_date: TODAY, sort_order: 4000 });
  });

  it("clears the date when the target is the No-date column", async () => {
    renderTwoDays();
    await dragOnto({ id: `group:${NO_DATE_KEY}`, rect: overRow("c").rect });

    const updates = ordersFrom();
    expect(updates).toEqual([
      { id: "x", input: { scheduled_date: null, sort_order: 1000 } },
    ]);
  });
});
