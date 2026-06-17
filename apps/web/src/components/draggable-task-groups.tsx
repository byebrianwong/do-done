"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
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
  applyDisplay,
  isManualSort,
  type DisplayConfig,
  type DisplayGroup,
  type GroupDropTarget,
  type Project,
  type Task,
  type UpdateTaskInput,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { seedFromDrop } from "@/lib/quick-add";
import { TaskItem } from "./task-item";
import { InlineTaskComposer } from "./inline-task-composer";

export interface DraggableTaskGroupsProps {
  tasks: Task[];
  projects?: Project[];
  config: DisplayConfig;
  /** Hide group headers when there's only a single "none" group. */
  hideHeaderForSingle?: boolean;
  /** Show the per-section inline "Add task" affordance. Off for read-only
   *  lists like Completed where adding makes no sense. Defaults to true. */
  quickAdd?: boolean;
}

const dropId = (groupKey: string) => `g:${groupKey}`;

/** Turn a group's drop target into the task patch a cross-group drop implies. */
function patchForDrop(drop: GroupDropTarget): UpdateTaskInput {
  switch (drop.field) {
    case "status":
      return { status: drop.value as Task["status"] };
    case "priority":
      return { priority: drop.value as Task["priority"] };
    case "project_id":
      return { project_id: drop.value };
    case "when_date":
      // when_date and when_bucket are mutually exclusive — clear the bucket.
      return { when_date: drop.value, when_bucket: null };
  }
}

export function DraggableTaskGroups({
  tasks,
  projects,
  config,
  hideHeaderForSingle = true,
  quickAdd = true,
}: DraggableTaskGroupsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Local optimistic copy; groups are re-derived from it every render so a
  // drag's field/order change is reflected immediately without refetching.
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);
  useEffect(() => setLocalTasks(tasks), [tasks]);

  // Track the in-flight drag so sections show the "Drop here" hint (and hide
  // the inline add affordance) only while a drag is actually happening.
  const [activeId, setActiveId] = useState<string | null>(null);

  const groups = useMemo(
    () => applyDisplay(localTasks, config, { projects }),
    [localTasks, config, projects]
  );

  const manual = isManualSort(config);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  if (groups.every((g) => g.count === 0)) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-neutral-400">No tasks match this view.</p>
      </div>
    );
  }

  if (!manual) {
    // Sorted view: static groups, no drag affordances.
    return (
      <div>
        {groups.map((g) => (
          <GroupSection
            key={g.key}
            group={g}
            projects={projects}
            droppable={false}
            sortableIds={null}
            isDragActive={false}
            quickAdd={quickAdd}
            hideHeader={hideHeaderForSingle && g.key === "none"}
          />
        ))}
      </div>
    );
  }

  function findGroupOf(taskId: string): DisplayGroup | undefined {
    return groups.find((g) => g.tasks.some((t) => t.id === taskId));
  }

  function applySortOrder(orderedIds: string[]): Map<string, number> {
    const map = new Map<string, number>();
    orderedIds.forEach((id, i) => map.set(id, (i + 1) * 1000));
    return map;
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const fromGroup = findGroupOf(activeId);
    if (!fromGroup) return;

    const toGroup = overId.startsWith("g:")
      ? groups.find((g) => g.key === overId.slice(2))
      : findGroupOf(overId);
    if (!toGroup) return;

    const snapshot = localTasks;
    const api = await getClientTasksApi();

    if (fromGroup.key === toGroup.key) {
      const ids = fromGroup.tasks.map((t) => t.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = overId === activeId ? oldIndex : ids.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      const orderedIds = arrayMove(ids, oldIndex, newIndex);
      const orders = applySortOrder(orderedIds);
      setLocalTasks((prev) =>
        prev.map((t) => (orders.has(t.id) ? { ...t, sort_order: orders.get(t.id)! } : t))
      );
      const updates = orderedIds.map((id) => ({
        id,
        input: { sort_order: orders.get(id)! },
      }));
      const { error } = await api.bulkUpdate(updates);
      if (error) {
        console.error("Reorder failed:", error);
        setLocalTasks(snapshot);
        return;
      }
    } else {
      // Cross-group drop only lands where the axis is a mutable field.
      if (!toGroup.drop) return;
      const patch = patchForDrop(toGroup.drop);

      const toIds = toGroup.tasks.map((t) => t.id).filter((id) => id !== activeId);
      const insertAt = overId.startsWith("g:")
        ? toIds.length
        : Math.max(toIds.indexOf(overId), 0);
      toIds.splice(insertAt, 0, activeId);
      const orders = applySortOrder(toIds);

      setLocalTasks((prev) =>
        prev.map((t) => {
          if (t.id === activeId)
            return { ...t, ...patch, sort_order: orders.get(t.id)! } as Task;
          if (orders.has(t.id)) return { ...t, sort_order: orders.get(t.id)! };
          return t;
        })
      );

      const updates: Array<{ id: string; input: UpdateTaskInput }> = [
        { id: activeId, input: { ...patch, sort_order: orders.get(activeId)! } },
      ];
      for (const id of toIds) {
        if (id === activeId) continue;
        updates.push({ id, input: { sort_order: orders.get(id)! } });
      }
      const { error } = await api.bulkUpdate(updates);
      if (error) {
        console.error("Move failed:", error);
        setLocalTasks(snapshot);
        return;
      }
    }
    startTransition(() => router.refresh());
  }

  return (
    <DndContext
      id="task-groups-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <div>
        {groups.map((g) => (
          <GroupSection
            key={g.key}
            group={g}
            projects={projects}
            droppable={g.drop !== null}
            sortableIds={g.tasks.map((t) => t.id)}
            isDragActive={activeId !== null}
            quickAdd={quickAdd}
            hideHeader={hideHeaderForSingle && g.key === "none"}
          />
        ))}
      </div>
    </DndContext>
  );
}

function GroupSection({
  group,
  projects,
  droppable,
  sortableIds,
  isDragActive,
  quickAdd,
  hideHeader,
}: {
  group: DisplayGroup;
  projects?: Project[];
  droppable: boolean;
  sortableIds: string[] | null;
  isDragActive: boolean;
  quickAdd: boolean;
  hideHeader: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dropId(group.key),
    disabled: !droppable,
  });

  const body = (
    <div
      ref={droppable ? setNodeRef : undefined}
      className={`min-h-[1.5rem] divide-y divide-neutral-100 rounded-md transition-colors dark:divide-neutral-800 ${
        isOver ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""
      }`}
    >
      {isDragActive && group.tasks.length === 0 && droppable ? (
        <div className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-600">
          Drop here
        </div>
      ) : null}
      {group.tasks.map((t) =>
        sortableIds ? (
          <SortableRow key={t.id} task={t} projects={projects} />
        ) : (
          <div key={t.id} className="py-px">
            <TaskItem task={t} projects={projects} />
          </div>
        )
      )}
    </div>
  );

  return (
    <section className="group mb-6">
      {!hideHeader && group.label ? (
        <h2
          className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
          style={{ color: group.color ?? "#9ca3af" }}
        >
          {group.color ? (
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: group.color }}
            />
          ) : null}
          {group.label}
          <span className="text-neutral-400">({group.count})</span>
        </h2>
      ) : null}
      {sortableIds ? (
        <SortableContext
          id={dropId(group.key)}
          items={sortableIds}
          strategy={verticalListSortingStrategy}
        >
          {body}
        </SortableContext>
      ) : (
        body
      )}
      {quickAdd && !isDragActive ? (
        <InlineTaskComposer seed={seedFromDrop(group.drop)} />
      ) : null}
    </section>
  );
}

function SortableRow({ task, projects }: { task: Task; projects?: Project[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });
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
