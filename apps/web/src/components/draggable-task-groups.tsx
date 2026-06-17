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
import { TaskItem } from "./task-item";
import { TaskDragOverlay } from "./task-drag-overlay";

export interface DraggableTaskGroupsProps {
  tasks: Task[];
  projects?: Project[];
  config: DisplayConfig;
  /** Hide group headers when there's only a single "none" group. */
  hideHeaderForSingle?: boolean;
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
      return { when_date: drop.value };
  }
}

export function DraggableTaskGroups({
  tasks,
  projects,
  config,
  hideHeaderForSingle = true,
}: DraggableTaskGroupsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Local optimistic copy; groups are re-derived from it every render so a
  // drag's field/order change is reflected immediately without refetching.
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);
  useEffect(() => setLocalTasks(tasks), [tasks]);

  const groups = useMemo(
    () => applyDisplay(localTasks, config, { projects }),
    [localTasks, config, projects]
  );

  const manual = isManualSort(config);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  // Id of the row currently being dragged — drives the lifted DragOverlay clone.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const activeTask = draggingId
    ? localTasks.find((t) => t.id === draggingId) ?? null
    : null;

  // Pre-drag snapshot. The live onDragOver moves below mutate `localTasks` in
  // place (changing the dragged task's field so it re-buckets into the hovered
  // group); this lets us revert if the drag is cancelled or the server rejects.
  const dragSnapshot = useRef<Task[] | null>(null);

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

  function handleDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
    dragSnapshot.current = localTasks.map((t) => ({ ...t }));
  }

  // Live cross-group move. As the dragged row crosses into another group, apply
  // that group's field (status / priority / project / date) to the task and
  // re-position it *during* the drag, so it re-buckets immediately: the origin
  // group collapses and the headers below the target slide down to preview the
  // drop (Todoist-style). Same-group reordering is left to the sortable strategy
  // and committed on drop.
  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    setLocalTasks((prev) => {
      const g = applyDisplay(prev, config, { projects });
      const fromGroup = g.find((grp) => grp.tasks.some((t) => t.id === activeId));
      const toGroup = overId.startsWith("g:")
        ? g.find((grp) => grp.key === overId.slice(2))
        : g.find((grp) => grp.tasks.some((t) => t.id === overId));
      // Only preview a move where the target axis is a mutable field.
      if (!fromGroup || !toGroup || fromGroup.key === toGroup.key || !toGroup.drop)
        return prev;

      const patch = patchForDrop(toGroup.drop);
      const toIds = toGroup.tasks
        .map((t) => t.id)
        .filter((id) => id !== activeId);
      let insertAt = toIds.length;
      if (!overId.startsWith("g:")) {
        const overIndex = toIds.indexOf(overId);
        if (overIndex >= 0) {
          const activeRect = active.rect.current.translated;
          const below =
            !!activeRect && activeRect.top > over.rect.top + over.rect.height;
          insertAt = overIndex + (below ? 1 : 0);
        }
      }
      toIds.splice(insertAt, 0, activeId);
      const orders = applySortOrder(toIds);

      return prev.map((t) => {
        if (t.id === activeId)
          return { ...t, ...patch, sort_order: orders.get(t.id)! } as Task;
        if (orders.has(t.id)) return { ...t, sort_order: orders.get(t.id)! };
        return t;
      });
    });
  }

  function handleDragCancel() {
    setDraggingId(null);
    if (dragSnapshot.current) setLocalTasks(dragSnapshot.current);
    dragSnapshot.current = null;
  }

  async function handleDragEnd(e: DragEndEvent) {
    setDraggingId(null);
    const snapshot = dragSnapshot.current;
    dragSnapshot.current = null;
    const { active, over } = e;
    const activeId = String(active.id);

    const restore = () => {
      if (snapshot) setLocalTasks(snapshot);
    };

    if (!over) {
      restore();
      return;
    }

    // Where it started (snapshot) vs where the live drag left it (current).
    const fromGroup = snapshot
      ? applyDisplay(snapshot, config, { projects }).find((grp) =>
          grp.tasks.some((t) => t.id === activeId)
        )
      : findGroupOf(activeId);
    const toGroup = findGroupOf(activeId);
    if (!fromGroup || !toGroup) {
      restore();
      return;
    }

    // Commit the final within-group position from the row we're hovering.
    const overId = String(over.id);
    let finalTasks = localTasks;
    if (!overId.startsWith("g:") && overId !== activeId) {
      const overGroup = findGroupOf(overId);
      if (overGroup?.key === toGroup.key) {
        const ids = toGroup.tasks.map((t) => t.id);
        const oldIndex = ids.indexOf(activeId);
        const newIndex = ids.indexOf(overId);
        if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
          const orders = applySortOrder(arrayMove(ids, oldIndex, newIndex));
          finalTasks = localTasks.map((t) =>
            orders.has(t.id) ? { ...t, sort_order: orders.get(t.id)! } : t
          );
          setLocalTasks(finalTasks);
        }
      }
    }

    // Nothing changed? (same group, identical order) → skip the write.
    const sameGroup = fromGroup.key === toGroup.key;
    const finalToIds = applyDisplay(finalTasks, config, { projects })
      .find((grp) => grp.key === toGroup.key)!
      .tasks.map((t) => t.id);
    if (sameGroup) {
      const before = fromGroup.tasks.map((t) => t.id);
      if (
        before.length === finalToIds.length &&
        before.every((id, i) => id === finalToIds[i])
      ) {
        return;
      }
    }

    const api = await getClientTasksApi();
    const orders = applySortOrder(finalToIds);

    let updates: Array<{ id: string; input: UpdateTaskInput }>;
    if (sameGroup) {
      updates = finalToIds.map((id) => ({
        id,
        input: { sort_order: orders.get(id)! },
      }));
    } else {
      const patch = toGroup.drop ? patchForDrop(toGroup.drop) : {};
      updates = [
        { id: activeId, input: { ...patch, sort_order: orders.get(activeId)! } },
      ];
      for (const id of finalToIds) {
        if (id === activeId) continue;
        updates.push({ id, input: { sort_order: orders.get(id)! } });
      }
    }

    const { error } = await api.bulkUpdate(updates);
    if (error) {
      console.error(sameGroup ? "Reorder failed:" : "Move failed:", error);
      restore();
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <DndContext
      id="task-groups-dnd"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div>
        {groups.map((g) => (
          <GroupSection
            key={g.key}
            group={g}
            projects={projects}
            droppable={g.drop !== null}
            sortableIds={g.tasks.map((t) => t.id)}
            hideHeader={hideHeaderForSingle && g.key === "none"}
          />
        ))}
      </div>
      <TaskDragOverlay task={activeTask} projects={projects} />
    </DndContext>
  );
}

function GroupSection({
  group,
  projects,
  droppable,
  sortableIds,
  hideHeader,
}: {
  group: DisplayGroup;
  projects?: Project[];
  droppable: boolean;
  sortableIds: string[] | null;
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
      {group.tasks.length === 0 && droppable ? (
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
    <section className="mb-6">
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
