"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
  type DragEndEvent,
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
      className="group flex items-stretch touch-none"
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
// handler: dropping a task here clears when_date / when_bucket; dragging
// FROM here onto a real date sets when_date on the target.
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

  useEffect(() => {
    setByDate(initial.byDate);
    setTasks(initial.tasks);
  }, [initial]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function findDateOf(id: string): string | null {
    for (const [date, ids] of byDate) {
      if (ids.includes(id)) return date;
    }
    return null;
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const fromDate = findDateOf(activeId);
    if (!fromDate) return;

    // Determine target date: either an empty-droppable id (group:<date>) or
    // an item id (look up which date it belongs to).
    const overId = String(over.id);
    let toDate: string | null = null;
    if (overId.startsWith("group:")) {
      toDate = overId.slice("group:".length);
    } else {
      toDate = findDateOf(overId);
    }
    if (!toDate) return;

    const nextByDate = new Map(byDate);
    if (fromDate === toDate) {
      const ids = [...(nextByDate.get(fromDate) ?? [])];
      const oldIndex = ids.indexOf(activeId);
      const newIndex = overId === activeId ? oldIndex : ids.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      nextByDate.set(fromDate, arrayMove(ids, oldIndex, newIndex));
      setByDate(nextByDate);

      const api = await getClientTasksApi();
      const updates = nextByDate
        .get(fromDate)!
        .map((id, i) => ({ id, input: { sort_order: (i + 1) * 1000 } }));
      const { error } = await api.bulkUpdate(updates);
      if (error) {
        console.error("Reorder failed:", error);
        setByDate(byDate);
        return;
      }
    } else {
      // Cross-section move: pull from `fromDate`, insert into `toDate`, and
      // update when_date on the moved task. Both ends can be the No-date
      // sentinel — moving INTO no-date clears when_date; moving OUT of
      // no-date sets when_date to the target day.
      const fromIds = [...(nextByDate.get(fromDate) ?? [])];
      const toIds = [...(nextByDate.get(toDate) ?? [])];
      const oldIndex = fromIds.indexOf(activeId);
      fromIds.splice(oldIndex, 1);
      const insertAt = overId.startsWith("group:")
        ? toIds.length
        : Math.max(toIds.indexOf(overId), 0);
      toIds.splice(insertAt, 0, activeId);
      nextByDate.set(fromDate, fromIds);
      nextByDate.set(toDate, toIds);
      setByDate(nextByDate);

      const toNoDate = toDate === NO_DATE_KEY;
      const nextWhenDate = toNoDate ? null : toDate;

      // Update the moved task locally so the title still renders correctly.
      const moved = tasks.get(activeId);
      if (moved) {
        const updated = {
          ...moved,
          when_date: nextWhenDate,
          when_bucket: toNoDate ? moved.when_bucket : null,
        };
        const nextTasks = new Map(tasks);
        nextTasks.set(activeId, updated);
        setTasks(nextTasks);
      }

      const api = await getClientTasksApi();
      const updates: Array<{
        id: string;
        input: {
          sort_order?: number;
          when_date?: string | null;
          when_bucket?: null;
        };
      }> = [
        {
          id: activeId,
          input: toNoDate
            ? { when_date: null }
            : { when_date: nextWhenDate as string, when_bucket: null },
        },
      ];
      toIds.forEach((id, i) =>
        updates.push({ id, input: { sort_order: (i + 1) * 1000 } })
      );
      const { error } = await api.bulkUpdate(updates);
      if (error) {
        console.error("Move failed:", error);
        setByDate(byDate);
        setTasks(initial.tasks);
        return;
      }
    }
    startTransition(() => router.refresh());
  }

  return (
    <DndContext
      id="upcoming-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
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
    </DndContext>
  );
}
