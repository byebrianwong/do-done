"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task, Project } from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { TaskItem } from "./task-item";
import { TaskDragOverlay } from "./task-drag-overlay";

export interface DraggableUpcomingProps {
  groups: Array<{
    date: string;
    label: string;
    tasks: Task[];
    emptyHint?: string;
  }>;
  projects?: Project[];
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
      className="group flex touch-manipulation items-stretch"
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
      className="flex w-5 items-center justify-center text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-neutral-700"
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

// Sentinel "date" for the No-date group. Treated specially in the drag
// handler: dropping a task here clears when_date; dragging FROM here onto a
// real date sets when_date on the target.
export const NO_DATE_KEY = "unscheduled";

function DateGroup({
  date,
  label,
  taskIds,
  tasks,
  projects,
  emptyHint,
}: {
  date: string;
  label: string;
  taskIds: string[];
  tasks: Map<string, Task>;
  projects?: Project[];
  emptyHint?: string;
}) {
  // Empty groups still need to be drop targets — use a fixed placeholder id
  // so SortableContext has something, but mark it as non-draggable.
  const { setNodeRef, isOver } = useDroppable({ id: `group:${date}` });
  return (
    <section>
      <h2 className="mb-2 border-b border-neutral-100 pb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:border-neutral-800">
        {label}
      </h2>
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
          {taskIds.length === 0 && (
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
    </section>
  );
}

export function DraggableUpcoming({ groups, projects }: DraggableUpcomingProps) {
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
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
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
        {groups.map((g) => (
          <DateGroup
            key={g.date}
            date={g.date}
            label={g.label}
            taskIds={byDate.get(g.date) ?? []}
            tasks={tasks}
            projects={projects}
            emptyHint={g.emptyHint}
          />
        ))}
      </div>
      <TaskDragOverlay task={activeTask} projects={projects} />
    </DndContext>
  );
}
