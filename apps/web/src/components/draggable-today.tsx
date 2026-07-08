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
import type { Project, Task, UpdateTaskInput } from "@do-done/shared";
import { partitionToday } from "@do-done/task-engine";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { OverdueSection } from "./overdue-section";
import { TaskItem } from "./task-item";
import { TaskDragOverlay } from "./task-drag-overlay";

/** Number of auto picks the Focus section fills to before user pins. */
const FOCUS_MAX = 3;
const FOCUS = "focus";
const OTHER = "other";
const dropId = (key: string) => `g:${key}`;

/** The task patch a drop into a given section implies (focus membership). */
function patchForSection(key: string): UpdateTaskInput {
  return key === FOCUS
    ? { focus_override: "include" }
    : { focus_override: "exclude" };
}

/**
 * Today's hand-designed layout with a drag-editable Focus section. Overdue is a
 * static block on top (overdue always wins, never a drop target). Focus and
 * Other are two droppable, sortable sections inside one DndContext: dragging a
 * row from Other into Focus pins it (`focus_override = 'include'`); dragging it
 * back out forces it out (`'exclude'`). Reordering within a section persists
 * `sort_order`. Cross-section moves re-bucket live during the drag (Todoist
 * style) by mutating the optimistic copy and re-running `partitionToday`.
 */
export function DraggableToday({
  tasks,
  projects,
  collapsed = [],
  onToggleCollapse,
}: {
  tasks: Task[];
  projects?: Project[];
  /** Collapsed section keys (FOCUS / OTHER) — persisted in the view's config. */
  collapsed?: string[];
  onToggleCollapse?: (key: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Optimistic copy; the three sections are re-derived from it each render so a
  // drag's focus_override / order change shows immediately without a refetch.
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);
  useEffect(() => setLocalTasks(tasks), [tasks]);

  const { overdue, focus, other } = useMemo(
    () => partitionToday(localTasks, FOCUS_MAX),
    [localTasks]
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const activeTask = draggingId
    ? localTasks.find((t) => t.id === draggingId) ?? null
    : null;

  // Pre-drag snapshot so a cancelled drag or a rejected write can revert the
  // live re-bucketing applied in onDragOver.
  const dragSnapshot = useRef<Task[] | null>(null);

  if (overdue.length === 0 && focus.length === 0 && other.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-neutral-400">
          Nothing scheduled for today. Add a task above.
        </p>
      </div>
    );
  }

  // The two draggable sections, derived from a task list.
  function sectionsOf(list: Task[]): Array<{ key: string; tasks: Task[] }> {
    const p = partitionToday(list, FOCUS_MAX);
    return [
      { key: FOCUS, tasks: p.focus },
      { key: OTHER, tasks: p.other },
    ];
  }

  function applySortOrder(orderedIds: string[]): Map<string, number> {
    const map = new Map<string, number>();
    orderedIds.forEach((id, i) => map.set(id, (i + 1) * 1000));
    return map;
  }

  function findSectionOf(list: Task[], id: string) {
    return sectionsOf(list).find((s) => s.tasks.some((t) => t.id === id));
  }

  function handleDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
    dragSnapshot.current = localTasks.map((t) => ({ ...t }));
  }

  // Live cross-section move: as the dragged row crosses into the other section,
  // apply that section's focus_override and reposition it so it re-buckets
  // immediately. Within-section reordering is handled by the sortable strategy
  // and committed on drop.
  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    setLocalTasks((prev) => {
      const secs = sectionsOf(prev);
      const fromS = secs.find((s) => s.tasks.some((t) => t.id === activeId));
      const toS = overId.startsWith("g:")
        ? secs.find((s) => s.key === overId.slice(2))
        : secs.find((s) => s.tasks.some((t) => t.id === overId));
      if (!fromS || !toS || fromS.key === toS.key) return prev;

      const patch = patchForSection(toS.key);
      const toIds = toS.tasks.map((t) => t.id).filter((id) => id !== activeId);
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

    const fromS = snapshot
      ? findSectionOf(snapshot, activeId)
      : findSectionOf(localTasks, activeId);
    const toS = findSectionOf(localTasks, activeId);
    if (!fromS || !toS) {
      restore();
      return;
    }

    // Commit the final within-section position from the row we're hovering.
    const overId = String(over.id);
    let finalTasks = localTasks;
    if (!overId.startsWith("g:") && overId !== activeId) {
      const overS = findSectionOf(localTasks, overId);
      if (overS?.key === toS.key) {
        const ids = toS.tasks.map((t) => t.id);
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

    const sameSection = fromS.key === toS.key;
    const finalToIds = sectionsOf(finalTasks)
      .find((s) => s.key === toS.key)!
      .tasks.map((t) => t.id);

    // Nothing changed (same section, identical order)? Skip the write.
    if (sameSection) {
      const before = fromS.tasks.map((t) => t.id);
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
    if (sameSection) {
      updates = finalToIds.map((id) => ({
        id,
        input: { sort_order: orders.get(id)! },
      }));
    } else {
      const patch = patchForSection(toS.key);
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
      console.error(sameSection ? "Reorder failed:" : "Focus move failed:", error);
      restore();
      return;
    }
    startTransition(() => router.refresh());
  }

  const isDragActive = draggingId !== null;

  return (
    <>
      <OverdueSection tasks={overdue} projects={projects} />
      <DndContext
        id="today-focus-dnd"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <FocusSection
          tasks={focus}
          projects={projects}
          isDragActive={isDragActive}
          collapsed={collapsed.includes(FOCUS)}
          onToggleCollapse={onToggleCollapse ? () => onToggleCollapse(FOCUS) : undefined}
        />
        <OtherSection
          tasks={other}
          projects={projects}
          isDragActive={isDragActive}
          collapsed={collapsed.includes(OTHER)}
          onToggleCollapse={onToggleCollapse ? () => onToggleCollapse(OTHER) : undefined}
        />
        <TaskDragOverlay task={activeTask} projects={projects} />
      </DndContext>
    </>
  );
}

function DroppableList({
  groupKey,
  tasks,
  projects,
  isDragActive,
  className,
}: {
  groupKey: string;
  tasks: Task[];
  projects?: Project[];
  isDragActive: boolean;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(groupKey) });
  return (
    <SortableContext
      id={dropId(groupKey)}
      items={tasks.map((t) => t.id)}
      strategy={verticalListSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={`min-h-[1.5rem] rounded-md transition-colors ${
          isOver ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""
        } ${className ?? ""}`}
      >
        {/* py-1 + text-xs = exactly the list's min-h (1.5rem), so an empty
            section doesn't grow when the hint appears at drag start. */}
        {isDragActive && tasks.length === 0 ? (
          <div className="px-3 py-1 text-xs text-neutral-400 dark:text-neutral-600">
            Drop here
          </div>
        ) : null}
        {tasks.map((t) => (
          <SortableRow key={t.id} task={t} projects={projects} />
        ))}
      </div>
    </SortableContext>
  );
}

/** Right-pointing chevron that rotates down when the section is expanded. */
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

/** Section heading; a button (collapse toggle) when onToggle is provided. */
function SectionHeading({
  label,
  count,
  collapsed,
  onToggle,
  colorClass,
  icon,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle?: () => void;
  colorClass: string;
  icon?: React.ReactNode;
}) {
  const base = `mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${colorClass}`;
  const inner = (
    <>
      <Chevron collapsed={collapsed} />
      {icon}
      {label}
      <span className="font-normal opacity-60">({count})</span>
    </>
  );
  return onToggle ? (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className={`${base} transition-opacity hover:opacity-70`}
    >
      {inner}
    </button>
  ) : (
    <h2 className={base}>{inner}</h2>
  );
}

function FocusSection({
  tasks,
  projects,
  isDragActive,
  collapsed,
  onToggleCollapse,
}: {
  tasks: Task[];
  projects?: Project[];
  isDragActive: boolean;
  collapsed: boolean;
  onToggleCollapse?: () => void;
}) {
  // Hidden when empty and idle; shown during a drag so it can receive a drop.
  if (tasks.length === 0 && !isDragActive) return null;
  return (
    <section className="mb-8">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
        <SectionHeading
          label="Focus"
          count={tasks.length}
          collapsed={collapsed}
          onToggle={onToggleCollapse}
          colorClass="text-indigo-600 dark:text-indigo-400"
          icon={
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          }
        />
        {/* Collapsed sections aren't drop targets in v1 — expand to drop in. */}
        {!collapsed ? (
          <DroppableList
            groupKey={FOCUS}
            tasks={tasks}
            projects={projects}
            isDragActive={isDragActive}
            className="space-y-0.5"
          />
        ) : null}
      </div>
    </section>
  );
}

function OtherSection({
  tasks,
  projects,
  isDragActive,
  collapsed,
  onToggleCollapse,
}: {
  tasks: Task[];
  projects?: Project[];
  isDragActive: boolean;
  collapsed: boolean;
  onToggleCollapse?: () => void;
}) {
  if (tasks.length === 0 && !isDragActive) return null;
  return (
    <section>
      <SectionHeading
        label="Other tasks"
        count={tasks.length}
        collapsed={collapsed}
        onToggle={onToggleCollapse}
        colorClass="text-neutral-400"
      />
      {!collapsed ? (
        <DroppableList
          groupKey={OTHER}
          tasks={tasks}
          projects={projects}
          isDragActive={isDragActive}
          className="divide-y divide-neutral-100 dark:divide-neutral-800"
        />
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
      className="group/row flex touch-manipulation items-stretch"
    >
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
      <div className="min-w-0 flex-1">
        <TaskItem task={task} projects={projects} />
      </div>
    </div>
  );
}
