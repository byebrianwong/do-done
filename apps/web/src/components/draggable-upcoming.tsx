"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ModalAwareMouseSensor,
  ModalAwareTouchSensor,
} from "@/lib/dnd-sensors";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CalendarEvent, Task, Project } from "@do-done/shared";
import {
  addDaysLocalISO,
  resolveQuickSchedule,
  todayLocalISO,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { buildRescheduleInput } from "@/lib/reschedule";
import { seedFromUpcomingDate } from "@/lib/quick-add";
import { TaskItem } from "./task-item";
import { NO_LINK_NAV_WHILE_DRAGGING } from "./linkified-text";
import { TaskDragOverlay } from "./task-drag-overlay";
import { InlineTaskComposer } from "./inline-task-composer";
import { CalendarEventList } from "./calendar-event-item";

/** One day column of the Upcoming view (or the Overdue/No-date sentinels). */
export interface UpcomingDateGroup {
  date: string;
  label: string;
  tasks: Task[];
  /** Read-only Google Calendar events on this day, shown above the tasks. */
  events?: CalendarEvent[];
  emptyHint?: string;
}

export interface DraggableUpcomingProps {
  groups: UpcomingDateGroup[];
  projects?: Project[];
  /** Collapsed day keys (g.date) — persisted in the view's config. */
  collapsed?: string[];
  onToggleCollapse?: (key: string) => void;
}

/** Right-pointing chevron that rotates down when the day is expanded. */
function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SortableRow({
  task,
  projects,
}: {
  task: Task;
  projects?: Project[];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      suppressHydrationWarning
      {...attributes}
      {...listeners}
      className={`group/row flex touch-manipulation items-stretch ${
        isDragging ? NO_LINK_NAV_WHILE_DRAGGING : ""
      }`}
    >
      <DragHandleIndicator />
      <div className="min-w-0 flex-1">
        <TaskItem task={task} projects={projects} />
      </div>
    </div>
  );
}

function DragHandleIndicator() {
  return (
    <div
      aria-hidden
      className="flex w-5 items-center justify-center text-neutral-300 opacity-0 transition-opacity group-hover/row:opacity-100 dark:text-neutral-700"
    >
      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
        <circle cx="7" cy="5" r="1.5" />
        <circle cx="13" cy="5" r="1.5" />
        <circle cx="7" cy="10" r="1.5" />
        <circle cx="13" cy="10" r="1.5" />
        <circle cx="7" cy="15" r="1.5" />
        <circle cx="13" cy="15" r="1.5" />
      </svg>
    </div>
  );
}

/**
 * The Overdue header's "Reschedule all" shortcut — mirrors the Today view's
 * OverdueSection so both surfaces clear a backlog with one tap. Moves every
 * overdue task in the group to Today / Tomorrow / Next week at once.
 */
function RescheduleAllButtons({
  busy,
  onReschedule,
}: {
  busy: boolean;
  onReschedule: (date: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden text-[11px] font-medium normal-case text-neutral-400 sm:inline">
        Reschedule all
      </span>
      <button
        type="button"
        onClick={() => onReschedule(todayLocalISO())}
        disabled={busy}
        className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold normal-case text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
      >
        Today
      </button>
      <button
        type="button"
        onClick={() => onReschedule(addDaysLocalISO(1))}
        disabled={busy}
        className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold normal-case text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900"
      >
        Tomorrow
      </button>
      <button
        type="button"
        onClick={() => onReschedule(resolveQuickSchedule("next_week"))}
        disabled={busy}
        className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold normal-case text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900"
      >
        Next week
      </button>
    </div>
  );
}

// Sentinel "date" for the No-date group. Treated specially in the drag
// handler: dropping a task here clears when_date; dragging FROM here onto a
// real date sets when_date on the target.
export const NO_DATE_KEY = "unscheduled";

// Sentinel "date" for the Overdue group. Overdue tasks can be dragged OUT onto
// a real day (reschedule), but nothing can be dropped INTO it — there is no
// single past date to assign. The drag handlers below block moves into it.
export const OVERDUE_KEY = "overdue";

function DateGroup({
  date,
  label,
  taskIds,
  tasks,
  events = [],
  projects,
  emptyHint,
  isDragActive,
  collapsed,
  onToggleCollapse,
  onRescheduleAll,
  rescheduleBusy = false,
}: {
  date: string;
  label: string;
  taskIds: string[];
  tasks: Map<string, Task>;
  events?: CalendarEvent[];
  projects?: Project[];
  emptyHint?: string;
  isDragActive: boolean;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  /** Overdue-only: reschedule every task in the group to a chosen day. */
  onRescheduleAll?: (date: string) => void;
  rescheduleBusy?: boolean;
}) {
  // Empty groups still need to be drop targets — use a fixed placeholder id
  // so SortableContext has something, but mark it as non-draggable.
  const { setNodeRef, isOver } = useDroppable({ id: `group:${date}` });
  // The Overdue group grows a "Reschedule all" toolbar next to its heading
  // (only when it has tasks) — the heading loses its own bottom border so the
  // whole row shares one.
  const showReschedule =
    date === OVERDUE_KEY && !!onRescheduleAll && taskIds.length > 0;
  const headingRow =
    "mb-2 border-b border-neutral-100 pb-2 dark:border-neutral-800";
  const headingText =
    "flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400";
  const headingWidth = showReschedule ? "min-w-0 flex-1" : `${headingRow} w-full`;
  const headingInner = (
    <>
      <Chevron collapsed={collapsed} />
      {label}
      {taskIds.length > 0 ? (
        <span className="font-normal opacity-60">({taskIds.length})</span>
      ) : null}
    </>
  );
  const heading = onToggleCollapse ? (
    <button
      type="button"
      onClick={onToggleCollapse}
      aria-expanded={!collapsed}
      className={`${headingText} ${headingWidth} transition-opacity hover:opacity-70`}
    >
      {headingInner}
    </button>
  ) : (
    <h2 className={`${headingText} ${headingWidth}`}>{headingInner}</h2>
  );
  return (
    <section className="group">
      {showReschedule ? (
        <div className={`${headingRow} flex items-center gap-2`}>
          {heading}
          <RescheduleAllButtons
            busy={rescheduleBusy}
            onReschedule={onRescheduleAll!}
          />
        </div>
      ) : (
        heading
      )}
      {/* Collapsed days aren't drop targets in v1 — expand to drop in. */}
      {!collapsed ? (
        <>
          {/* Calendar events sit above the tasks: they're fixed points in the
              day the tasks schedule around. Not drag targets. */}
          <CalendarEventList events={events} />
          <SortableContext
            id={`group:${date}`}
            items={taskIds}
            strategy={verticalListSortingStrategy}
          >
            <div
              ref={setNodeRef}
              className={`min-h-[2.5rem] space-y-0.5 rounded-md p-0.5 transition-colors ${
                isOver ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""
              }`}
            >
              {/* The empty-state hint is drag guidance — show it only mid-drag. */}
              {isDragActive && taskIds.length === 0 && (
                <div className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-600">
                  {emptyHint ?? "Drop here"}
                </div>
              )}
              {taskIds.map((id) => {
                const t = tasks.get(id);
                if (!t) return null;
                return <SortableRow key={id} task={t} projects={projects} />;
              })}
            </div>
          </SortableContext>
          {/* Overdue is a read-only bucket — no composer (can't add into the
              past). Hidden (not unmounted) while a drag is active: unmounting
              collapses the composer's row and shifts every day below it the
              moment a drag starts. `invisible` keeps the layout box. */}
          {date !== OVERDUE_KEY && (
            <div className={isDragActive ? "invisible" : undefined}>
              <InlineTaskComposer seed={seedFromUpcomingDate(date)} />
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

export function DraggableUpcoming({
  groups,
  projects,
  collapsed = [],
  onToggleCollapse,
}: DraggableUpcomingProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const initial = useMemo(() => {
    const m = new Map<string, string[]>();
    const t = new Map<string, Task>();
    for (const g of groups) {
      m.set(g.date, g.tasks.map((task) => task.id));
      for (const task of g.tasks) t.set(task.id, task);
    }
    return { byDate: m, tasks: t };
  }, [groups]);

  const [byDate, setByDate] = useState(initial.byDate);
  const [tasks, setTasks] = useState(initial.tasks);

  // "Reschedule all" flight state: disables the toolbar while the bulk write
  // is in progress so the buttons can't be double-fired.
  const [rescheduling, setRescheduling] = useState(false);

  // Id of the row currently being dragged — drives the lifted DragOverlay clone.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const activeTask = draggingId ? tasks.get(draggingId) ?? null : null;

  useEffect(() => {
    setByDate(initial.byDate);
    setTasks(initial.tasks);
  }, [initial]);

  // Mouse drags after a 4px move; touch drags after a short press so a swipe
  // scrolls the page rather than picking up a task.
  const sensors = useSensors(
    useSensor(ModalAwareMouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(ModalAwareTouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    })
  );

  // Snapshot of the pre-drag layout, taken on drag start. The live onDragOver
  // moves below mutate `byDate`/`tasks` in place; this lets us revert cleanly if
  // the drag is cancelled or the server rejects the change.
  const dragSnapshot = useRef<{
    byDate: Map<string, string[]>;
    tasks: Map<string, Task>;
  } | null>(null);

  function findDateOf(id: string): string | null {
    for (const [date, ids] of byDate) {
      if (ids.includes(id)) return date;
    }
    return null;
  }

  function handleDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
    dragSnapshot.current = {
      byDate: new Map([...byDate].map(([d, ids]) => [d, [...ids]])),
      tasks: new Map(tasks),
    };
  }

  // Live cross-section move. As the dragged row crosses into another day, pull
  // it out of its current day and splice it into the hovered one *during* the
  // drag — so the origin day collapses and every header below the target slides
  // down to preview exactly where the task would land (Todoist-style). Same-day
  // reordering is left to the sortable strategy and committed on drop.
  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    setByDate((prev) => {
      const dateOf = (id: string) => {
        for (const [d, ids] of prev) if (ids.includes(id)) return d;
        return null;
      };
      const fromDate = dateOf(activeId);
      const toDate = overId.startsWith("group:")
        ? overId.slice("group:".length)
        : dateOf(overId);
      if (!fromDate || !toDate || fromDate === toDate) return prev;
      // Overdue is read-only as a target — you can't schedule into the past.
      if (toDate === OVERDUE_KEY) return prev;

      const next = new Map(prev);
      const fromIds = [...(next.get(fromDate) ?? [])];
      const toIds = [...(next.get(toDate) ?? [])];
      const fromIndex = fromIds.indexOf(activeId);
      if (fromIndex < 0) return prev;
      fromIds.splice(fromIndex, 1);

      let insertAt = toIds.length;
      if (!overId.startsWith("group:")) {
        const overIndex = toIds.indexOf(overId);
        if (overIndex >= 0) {
          const activeRect = active.rect.current.translated;
          const below =
            !!activeRect && activeRect.top > over.rect.top + over.rect.height;
          insertAt = overIndex + (below ? 1 : 0);
        }
      }
      toIds.splice(insertAt, 0, activeId);
      next.set(fromDate, fromIds);
      next.set(toDate, toIds);
      return next;
    });
  }

  function restoreFromSnapshot() {
    const snap = dragSnapshot.current;
    if (snap) {
      setByDate(snap.byDate);
      setTasks(snap.tasks);
    }
  }

  function handleDragCancel() {
    setDraggingId(null);
    restoreFromSnapshot();
    dragSnapshot.current = null;
  }

  async function handleDragEnd(e: DragEndEvent) {
    setDraggingId(null);
    const snap = dragSnapshot.current;
    dragSnapshot.current = null;
    const { active, over } = e;
    const activeId = String(active.id);

    if (!over) {
      if (snap) {
        setByDate(snap.byDate);
        setTasks(snap.tasks);
      }
      return;
    }

    // Where it started (snapshot) vs where the live drag left it (current state).
    const fromDate =
      [...(snap?.byDate ?? new Map())].find(([, ids]) =>
        ids.includes(activeId)
      )?.[0] ?? null;
    const toDate = findDateOf(activeId);
    if (!fromDate || !toDate) {
      if (snap) {
        setByDate(snap.byDate);
        setTasks(snap.tasks);
      }
      return;
    }

    // Commit the final same-day position from the row we're hovering.
    const overId = String(over.id);
    let finalByDate = byDate;
    if (!overId.startsWith("group:") && overId !== activeId) {
      const overDate = findDateOf(overId);
      if (overDate === toDate) {
        const ids = [...(byDate.get(toDate) ?? [])];
        const oldIndex = ids.indexOf(activeId);
        const newIndex = ids.indexOf(overId);
        if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
          finalByDate = new Map(byDate);
          finalByDate.set(toDate, arrayMove(ids, oldIndex, newIndex));
          setByDate(finalByDate);
        }
      }
    }

    // Nothing actually moved? (no day change and identical order) → no write.
    if (fromDate === toDate) {
      const before = snap?.byDate.get(fromDate) ?? [];
      const after = finalByDate.get(fromDate) ?? [];
      if (
        before.length === after.length &&
        before.every((id, i) => id === after[i])
      ) {
        return;
      }
    }

    const api = await getClientTasksApi();
    const toIds = finalByDate.get(toDate) ?? [];

    if (fromDate === toDate) {
      const updates = toIds.map((id, i) => ({
        id,
        input: { sort_order: (i + 1) * 1000 },
      }));
      const { error } = await api.bulkUpdate(updates);
      if (error) {
        console.error("Reorder failed:", error);
        if (snap) {
          setByDate(snap.byDate);
          setTasks(snap.tasks);
        }
        return;
      }
    } else {
      // Overdue has no single past date to assign, so it's never a valid drop
      // target. handleDragOver already blocks previews into it; guard the
      // commit too so a stray drop can't write when_date: "overdue".
      if (toDate === OVERDUE_KEY) {
        if (snap) {
          setByDate(snap.byDate);
          setTasks(snap.tasks);
        }
        return;
      }

      // Cross-section: update when_date on the moved task. Both ends can be the
      // No-date sentinel — moving INTO no-date clears when_date; moving OUT of
      // no-date sets when_date to the target day.
      const toNoDate = toDate === NO_DATE_KEY;
      const nextWhenDate = toNoDate ? null : toDate;

      const moved = tasks.get(activeId);
      if (moved) {
        const nextTasks = new Map(tasks);
        nextTasks.set(activeId, {
          ...moved,
          when_date: nextWhenDate,
        });
        setTasks(nextTasks);
      }

      const updates: Array<{
        id: string;
        input: {
          sort_order?: number;
          when_date?: string | null;
        };
      }> = [
        {
          id: activeId,
          input: toNoDate
            ? { when_date: null }
            : { when_date: nextWhenDate as string },
        },
      ];
      toIds.forEach((id, i) =>
        updates.push({ id, input: { sort_order: (i + 1) * 1000 } })
      );
      const { error } = await api.bulkUpdate(updates);
      if (error) {
        console.error("Move failed:", error);
        if (snap) {
          setByDate(snap.byDate);
          setTasks(snap.tasks);
        }
        return;
      }
    }
    startTransition(() => router.refresh());
  }

  // Move every overdue task to a chosen day in one write, then let the refresh
  // re-file them into their new columns. Slides past due dates forward via the
  // same helper the per-row and Today reschedules use.
  async function rescheduleAll(date: string) {
    const overdueIds = byDate.get(OVERDUE_KEY) ?? [];
    const overdueTasks = overdueIds
      .map((id) => tasks.get(id))
      .filter((t): t is Task => t !== undefined);
    if (overdueTasks.length === 0) return;

    setRescheduling(true);
    const api = await getClientTasksApi();
    const target = { kind: "date" as const, date };
    const updates = overdueTasks.map((t) => ({
      id: t.id,
      input: buildRescheduleInput(t, target),
    }));
    const { error } = await api.bulkUpdate(updates);
    setRescheduling(false);
    if (error) {
      console.error("Bulk reschedule failed:", error);
      return;
    }
    // Empty the Overdue bucket optimistically so its group hides at once (see
    // visibleGroups); the refresh then re-files the tasks into their new day
    // columns and drops the group from `groups` for good.
    setByDate((prev) => {
      const next = new Map(prev);
      next.set(OVERDUE_KEY, []);
      return next;
    });
    startTransition(() => router.refresh());
  }

  // Drop the Overdue group once it's been emptied by a "reschedule all" — but
  // keep it during a drag, where dragging the last row out empties it only
  // transiently and the header shouldn't flicker away under the cursor.
  const visibleGroups = groups.filter(
    (g) =>
      g.date !== OVERDUE_KEY ||
      draggingId !== null ||
      (byDate.get(OVERDUE_KEY)?.length ?? 0) > 0
  );

  return (
    <DndContext
      id="upcoming-dnd"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-6">
        {visibleGroups.map((g) => (
          <DateGroup
            key={g.date}
            date={g.date}
            label={g.label}
            taskIds={byDate.get(g.date) ?? []}
            tasks={tasks}
            events={g.events}
            projects={projects}
            emptyHint={g.emptyHint}
            isDragActive={draggingId !== null}
            collapsed={collapsed.includes(g.date)}
            onToggleCollapse={
              onToggleCollapse ? () => onToggleCollapse(g.date) : undefined
            }
            onRescheduleAll={g.date === OVERDUE_KEY ? rescheduleAll : undefined}
            rescheduleBusy={rescheduling}
          />
        ))}
      </div>
      <TaskDragOverlay task={activeTask} projects={projects} />
    </DndContext>
  );
}
