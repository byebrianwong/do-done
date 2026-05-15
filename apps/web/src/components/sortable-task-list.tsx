"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
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

export interface SortableTaskListProps {
  tasks: Task[];
  projects?: Project[];
  /**
   * Optional divider className applied between rows; matches the
   * `divide-y` style used elsewhere when not dragging.
   */
  className?: string;
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
      className="group flex items-stretch border-b border-neutral-100 last:border-b-0 dark:border-neutral-800"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="flex w-5 cursor-grab items-center justify-center text-neutral-300 opacity-0 transition-opacity hover:text-neutral-500 group-hover:opacity-100 active:cursor-grabbing dark:text-neutral-700"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <circle cx="7" cy="5" r="1.5" />
          <circle cx="13" cy="5" r="1.5" />
          <circle cx="7" cy="10" r="1.5" />
          <circle cx="13" cy="10" r="1.5" />
          <circle cx="7" cy="15" r="1.5" />
          <circle cx="13" cy="15" r="1.5" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <TaskItem task={task} projects={projects} />
      </div>
    </div>
  );
}

export function SortableTaskList({
  tasks,
  projects,
}: SortableTaskListProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, setItems] = useState(tasks);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // Resync local order whenever the server returns a new set of ids.
  const idsKey = tasks.map((t) => t.id).join(",");
  useEffect(() => {
    setItems(tasks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((t) => t.id === active.id);
    const newIndex = items.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);

    const api = await getClientTasksApi();
    const updates = next.map((t, i) => ({
      id: t.id,
      input: { sort_order: (i + 1) * 1000 },
    }));
    const { error } = await api.bulkUpdate(updates);
    if (error) {
      console.error("Reorder failed:", error);
      setItems(items);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <DndContext
      id="sortable-task-list-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div>
          {items.map((task) => (
            <SortableRow key={task.id} task={task} projects={projects} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
