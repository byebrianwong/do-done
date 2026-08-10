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
 * Play a whole drag: pick up, hover each `over` in turn, drop on the last one.
 * Each step goes through `act` because the handler that runs the next one is
 * re-created on the render its predecessor's setState causes — which is also
 * the order the browser does it in, a frame apart.
 */
async function dragOver(...overs: Array<{ id: string; rect: unknown }>) {
  await act(async () => {
    handlers.onDragStart!({ active: { id: "x" } } as unknown as DragStartEvent);
  });
  for (const over of overs) {
    await act(async () => {
      handlers.onDragOver!({
        active: activeBelow,
        over,
      } as unknown as DragOverEvent);
    });
  }
  await act(async () => {
    await handlers.onDragEnd!({
      active: activeBelow,
      over: overs[overs.length - 1],
    } as unknown as DragEndEvent);
  });
}

const dragOnto = (over: { id: string; rect: unknown }) => dragOver(over);

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

  it("writes the slot the hovered row is giving up, not the one the crossing spliced into", async () => {
    renderTwoDays();
    // Crossing into Today splices X in by geometry — under `c`, here. Nobody
    // sees that: dnd-kit's sortable strategy is what's on screen, and it
    // displaces the day's rows by arrayMove(active → over), showing X in c's
    // slot with c pushed down. Honouring the splice landed X a slot below the
    // gap the user was looking at.
    await dragOnto(overRow("c"));

    const updates = ordersFrom();
    expect(updates.map((u) => u.id)).toEqual(["a", "b", "x", "c"]);
    expect(updates.map((u) => u.input.sort_order)).toEqual([
      1000, 2000, 3000, 4000,
    ]);
  });

  it("keeps following the pointer once the row is in the day", async () => {
    renderTwoDays();
    // The bug this suite exists for: the first hover is what moved X into
    // Today, and every hover after it is a same-day one, which handleDragOver
    // leaves alone. The preview still tracks the pointer all the way to the
    // top of the day, so the drop has to as well.
    await dragOver(overRow("c"), overRow("a"));

    expect(ordersFrom().map((u) => u.id)).toEqual(["x", "a", "b", "c"]);
  });

  it("keeps the crossing's placement when the drop lands on the day itself", async () => {
    renderTwoDays();
    // A drop past the last row reports the day, not a row — nothing is
    // displaced, so there is no preview to read and the bottom placement
    // handleDragOver made is the one on screen.
    await dragOnto({ id: `group:${TODAY}`, rect: overRow("c").rect });

    expect(ordersFrom().map((u) => u.id)).toEqual(["a", "b", "c", "x"]);
  });

  it("patches the moved row once, with its new day and its new place together", async () => {
    renderTwoDays();
    await dragOnto(overRow("c"));

    const updates = ordersFrom();
    const forX = updates.filter((u) => u.id === "x");
    expect(forX).toHaveLength(1);
    expect(forX[0].input).toEqual({ scheduled_date: TODAY, sort_order: 3000 });
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
