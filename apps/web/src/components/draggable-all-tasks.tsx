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
import {
  STATUS_CONFIG,
  STATUS_ORDER,
  type Project,
  type Task,
  type TaskStatus,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { TaskItem } from "./task-item";

export interface DraggableAllTasksProps {
  tasks: Task[];
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
      <div className="min-w-0 flex-1">
        <TaskItem task={task} projects={projects} />
      </div>
    </div>
  );
}

function StatusGroup({
  status,
  taskIds,
  tasks,
  projects,
}: {
  status: TaskStatus;
  taskIds: string[];
  tasks: Map<string, Task>;
  projects?: Project[];
}) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` });
  return (
    <section className="mb-6">
      <h2
        className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: cfg.color }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: cfg.color }}
        />
        {cfg.label}
        <span className="text-neutral-400">({taskIds.length})</span>
      </h2>
      <SortableContext
        id={`status:${status}`}
        items={taskIds}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={`min-h-[2.5rem] divide-y divide-neutral-100 rounded-md transition-colors dark:divide-neutral-800 ${
            isOver ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""
          }`}
        >
          {taskIds.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-600">
              Drop here to set status
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

export function DraggableAllTasks({ tasks, projects }: DraggableAllTasksProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const initial = useMemo(() => {
    const byStatus = new Map<TaskStatus, string[]>();
    const taskMap = new Map<string, Task>();
    for (const s of STATUS_ORDER) byStatus.set(s, []);
    for (const t of tasks) {
      taskMap.set(t.id, t);
      byStatus.get(t.status)?.push(t.id);
    }
    return { byStatus, tasks: taskMap };
  }, [tasks]);

  const [byStatus, setByStatus] = useState(initial.byStatus);
  const [taskMap, setTaskMap] = useState(initial.tasks);

  useEffect(() => {
    setByStatus(initial.byStatus);
    setTaskMap(initial.tasks);
  }, [initial]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  function findStatusOf(id: string): TaskStatus | null {
    for (const [status, ids] of byStatus) {
      if (ids.includes(id)) return status;
    }
    return null;
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const fromStatus = findStatusOf(activeId);
    if (!fromStatus) return;

    // Resolve target: either an empty-droppable `status:<s>` id, or a task
    // id whose group we look up.
    const overId = String(over.id);
    let toStatus: TaskStatus | null = null;
    if (overId.startsWith("status:")) {
      toStatus = overId.slice("status:".length) as TaskStatus;
    } else {
      toStatus = findStatusOf(overId);
    }
    if (!toStatus) return;

    const nextByStatus = new Map(byStatus);

    if (fromStatus === toStatus) {
      // Reorder within a status group.
      const ids = [...(nextByStatus.get(fromStatus) ?? [])];
      const oldIndex = ids.indexOf(activeId);
      const newIndex = overId === activeId ? oldIndex : ids.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      nextByStatus.set(fromStatus, arrayMove(ids, oldIndex, newIndex));
      setByStatus(nextByStatus);

      const api = await getClientTasksApi();
      const updates = nextByStatus
        .get(fromStatus)!
        .map((id, i) => ({ id, input: { sort_order: (i + 1) * 1000 } }));
      const { error } = await api.bulkUpdate(updates);
      if (error) {
        console.error("Reorder failed:", error);
        setByStatus(byStatus);
        return;
      }
    } else {
      // Cross-status move: pull from `fromStatus`, insert into `toStatus`,
      // and update status on the moved task. status → done flows through
      // TasksApi.update which stamps completed_at and fires pet feeding.
      const fromIds = [...(nextByStatus.get(fromStatus) ?? [])];
      const toIds = [...(nextByStatus.get(toStatus) ?? [])];
      const oldIndex = fromIds.indexOf(activeId);
      fromIds.splice(oldIndex, 1);
      const insertAt = overId.startsWith("status:")
        ? toIds.length
        : Math.max(toIds.indexOf(overId), 0);
      toIds.splice(insertAt, 0, activeId);
      nextByStatus.set(fromStatus, fromIds);
      nextByStatus.set(toStatus, toIds);
      setByStatus(nextByStatus);

      // Update local copy so the row still renders with the new status while
      // the network update is in flight.
      const moved = taskMap.get(activeId);
      if (moved) {
        const updated: Task = { ...moved, status: toStatus };
        const next = new Map(taskMap);
        next.set(activeId, updated);
        setTaskMap(next);
      }

      const api = await getClientTasksApi();
      const updates: Array<{
        id: string;
        input: { sort_order?: number; status?: TaskStatus };
      }> = [{ id: activeId, input: { status: toStatus } }];
      toIds.forEach((id, i) =>
        updates.push({ id, input: { sort_order: (i + 1) * 1000 } })
      );
      const { error } = await api.bulkUpdate(updates);
      if (error) {
        console.error("Status move failed:", error);
        setByStatus(byStatus);
        setTaskMap(initial.tasks);
        return;
      }
    }
    startTransition(() => router.refresh());
  }

  return (
    <DndContext
      id="all-tasks-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div>
        {STATUS_ORDER.map((s) => (
          <StatusGroup
            key={s}
            status={s}
            taskIds={byStatus.get(s) ?? []}
            tasks={taskMap}
            projects={projects}
          />
        ))}
      </div>
    </DndContext>
  );
}
