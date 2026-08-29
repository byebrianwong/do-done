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
import {
  applyDisplay,
  isCollapsed,
  isManualSort,
  toggleCollapsed,
  withSort,
  type DisplayConfig,
  type DisplayGroup,
  type GroupDropTarget,
  type Project,
  type Task,
  type UpdateTaskInput,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { seedFromDrop } from "@/lib/quick-add";
import {
  SectionOpenProvider,
  TaskRowBehaviorProvider,
  useIsCompact,
} from "@/lib/task-row-behavior";
import { TaskItem } from "./task-item";
import {
  STICKY_SECTION_HEADER,
  SectionCaret,
  SectionCount,
  SectionDot,
  sectionHeaderClass,
} from "./section-header";
import { NO_LINK_NAV_WHILE_DRAGGING } from "./linkified-text";
import { TaskDragOverlay } from "./task-drag-overlay";
import { InlineTaskComposer } from "./inline-task-composer";

export interface DraggableTaskGroupsProps {
  tasks: Task[];
  projects?: Project[];
  config: DisplayConfig;
  /** Lets a drag in a *sorted* view convert it to manual sort. When omitted,
   *  sorted views stay static (drag disabled) — the pre-feature behaviour. */
  onConfigChange?: (next: DisplayConfig) => void;
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
    case "scheduled_date":
      return { scheduled_date: drop.value };
  }
}

export function DraggableTaskGroups({
  tasks,
  projects,
  config,
  onConfigChange,
  hideHeaderForSingle = true,
  quickAdd = true,
}: DraggableTaskGroupsProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Local optimistic copy; groups are re-derived from it every render so a
  // drag's field/order change is reflected immediately without refetching.
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);
  useEffect(() => setLocalTasks(tasks), [tasks]);

  // A sorted view can be dragged to *convert* it to manual sort (Todoist-style):
  // on drag start we freeze the current order into sort_order and render as
  // manual for the gesture; on drop we persist that order + flip sort to manual.
  const sortedView = !isManualSort(config);
  const canConvert = sortedView && !!onConfigChange;
  const [converting, setConverting] = useState(false);
  const effectiveConfig = useMemo(
    () => (sortedView && converting ? withSort(config, "manual") : config),
    [sortedView, converting, config]
  );

  const groups = useMemo(
    () => applyDisplay(localTasks, effectiveConfig, { projects }),
    [localTasks, effectiveConfig, projects]
  );

  // When the list is grouped by status, each group header already states the
  // status for every row it contains, so the per-row status pill is pure
  // redundancy. Suppress it in that case (the drag-to-manual conversion only
  // touches `sort`, never `group`, so `config.group` is stable here).
  const groupedByStatus = config.group === "status";

  const sensors = useSensors(
    useSensor(ModalAwareMouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(ModalAwareTouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    })
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

  if (sortedView && !canConvert) {
    // Sorted view with no convert handler: static groups, no drag affordances.
    return (
      <TaskRowBehaviorProvider
        keepsCompleted={config.showCompleted}
        density={config.density}
        rowStyle={config.rowStyle}
      >
      <div>
        {groups.map((g) => (
          <GroupSection
            key={g.key}
            group={g}
            projects={projects}
            hideStatusBadge={groupedByStatus}
            droppable={false}
            sortableIds={null}
            isDragActive={false}
            quickAdd={quickAdd}
            hideHeader={hideHeaderForSingle && g.key === "none"}
            collapsed={isCollapsed(config, g.key)}
            onToggleCollapse={
              onConfigChange
                ? () => onConfigChange(toggleCollapsed(config, g.key))
                : undefined
            }
          />
        ))}
      </div>
      </TaskRowBehaviorProvider>
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
    if (canConvert) {
      // Freeze the current sorted order into sort_order so flipping to manual
      // rendering keeps the rows exactly where they are (no jump), then let the
      // gesture proceed as a manual drag. Snapshot the seeded order so the
      // drop's no-op check compares against what the user actually saw.
      const orderedIds = groups.flatMap((g) => g.tasks.map((t) => t.id));
      const orders = applySortOrder(orderedIds);
      const seeded = localTasks.map((t) =>
        orders.has(t.id) ? { ...t, sort_order: orders.get(t.id)! } : t
      );
      dragSnapshot.current = seeded.map((t) => ({ ...t }));
      setLocalTasks(seeded);
      setConverting(true);
    } else {
      dragSnapshot.current = localTasks.map((t) => ({ ...t }));
    }
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
      const g = applyDisplay(prev, effectiveConfig, { projects });
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
    setConverting(false);
    if (dragSnapshot.current) setLocalTasks(dragSnapshot.current);
    dragSnapshot.current = null;
  }

  async function handleDragEnd(e: DragEndEvent) {
    setDraggingId(null);
    const snapshot = dragSnapshot.current;
    dragSnapshot.current = null;
    const convert = converting;
    setConverting(false);
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
      ? applyDisplay(snapshot, effectiveConfig, { projects }).find((grp) =>
          grp.tasks.some((t) => t.id === activeId)
        )
      : findGroupOf(activeId);
    const toGroup = findGroupOf(activeId);
    if (!fromGroup || !toGroup) {
      restore();
      return;
    }

    // Commit the position the preview is showing — for a cross-group drop as
    // much as a within-group one. Once handleDragOver has moved the row into
    // the hovered group, dnd-kit's sortable strategy owns what is *on screen*:
    // it displaces the group's rows by arrayMove(active → over), and keeps
    // doing so as the pointer moves on. The index handleDragOver spliced the
    // row in at is invisible, and typically a slot off from that — so honouring
    // it landed the row somewhere other than the gap the user was looking at.
    // `over` is read only while it is a sibling row: a drop on the group itself
    // (`g:`) or back on the dragged row displaces nothing, so there is no
    // preview to match and handleDragOver's placement stands.
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

    // Nothing changed? (same group, identical order) → skip the write (and don't
    // convert a sorted view from a drag that didn't actually move anything).
    const sameGroup = fromGroup.key === toGroup.key;
    const finalToIds = applyDisplay(finalTasks, effectiveConfig, { projects })
      .find((grp) => grp.key === toGroup.key)!
      .tasks.map((t) => t.id);
    if (sameGroup) {
      const before = fromGroup.tasks.map((t) => t.id);
      if (
        before.length === finalToIds.length &&
        before.every((id, i) => id === finalToIds[i])
      ) {
        restore();
        return;
      }
    }

    const api = await getClientTasksApi();

    let updates: Array<{ id: string; input: UpdateTaskInput }>;
    if (convert) {
      // Converting a sorted view → manual: lock in the *entire* displayed order
      // (across every group) as sort_order so nothing reshuffles after refresh,
      // plus the dragged task's cross-group field change.
      const allIds = applyDisplay(finalTasks, effectiveConfig, { projects }).flatMap(
        (grp) => grp.tasks.map((t) => t.id)
      );
      const orders = applySortOrder(allIds);
      const patch = !sameGroup && toGroup.drop ? patchForDrop(toGroup.drop) : {};
      updates = allIds.map((id) => ({
        id,
        input:
          id === activeId
            ? { ...patch, sort_order: orders.get(id)! }
            : { sort_order: orders.get(id)! },
      }));
    } else {
      const orders = applySortOrder(finalToIds);
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
    }

    const { error } = await api.bulkUpdate(updates);
    if (error) {
      console.error(
        convert ? "Convert-to-manual failed:" : sameGroup ? "Reorder failed:" : "Move failed:",
        error
      );
      restore();
      return;
    }
    if (convert && onConfigChange) onConfigChange(withSort(config, "manual"));
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
      {/* With "show completed" on, a ticked-off task stays in this list, so its
          row must not play the collapse-and-vanish completion exit. Declared
          here as well as in CuratedDisplayView because this component is also
          mounted directly, with a config of its own. */}
      <TaskRowBehaviorProvider
        keepsCompleted={config.showCompleted}
        density={config.density}
        rowStyle={config.rowStyle}
      >
      <div>
        {groups.map((g) => {
          const collapsed = isCollapsed(config, g.key);
          return (
            <GroupSection
              key={g.key}
              group={g}
              projects={projects}
              hideStatusBadge={groupedByStatus}
              // Collapsed sections aren't drop targets in v1 — expand to drop in.
              droppable={g.drop !== null && !collapsed}
              sortableIds={g.tasks.map((t) => t.id)}
              isDragActive={draggingId !== null}
              quickAdd={quickAdd}
              hideHeader={hideHeaderForSingle && g.key === "none"}
              collapsed={collapsed}
              onToggleCollapse={
                onConfigChange
                  ? () => onConfigChange(toggleCollapsed(config, g.key))
                  : undefined
              }
            />
          );
        })}
      </div>
      <TaskDragOverlay
        task={activeTask}
        projects={projects}
        hideStatusBadge={groupedByStatus}
      />
      </TaskRowBehaviorProvider>
    </DndContext>
  );
}

function GroupSection({
  group,
  projects,
  hideStatusBadge,
  droppable,
  sortableIds,
  isDragActive,
  quickAdd,
  hideHeader,
  collapsed,
  onToggleCollapse,
}: {
  group: DisplayGroup;
  projects?: Project[];
  hideStatusBadge: boolean;
  droppable: boolean;
  sortableIds: string[] | null;
  isDragActive: boolean;
  quickAdd: boolean;
  hideHeader: boolean;
  collapsed: boolean;
  onToggleCollapse?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: dropId(group.key),
    disabled: !droppable,
  });
  // Row padding alone doesn't buy much on a view like All tasks, where a dozen
  // project headers each cost a header, a gap and a section margin. Compact
  // tightens the chrome between groups by roughly as much as it tightens rows.
  const compact = useIsCompact();

  const body = (
    <div
      ref={droppable ? setNodeRef : undefined}
      className={`min-h-[1.5rem] divide-y divide-neutral-100 rounded-md transition-colors dark:divide-neutral-800 ${
        isOver ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""
      }`}
    >
      {/* py-1 + text-xs = exactly the body's min-h (1.5rem), so an empty
          group doesn't grow when the hint appears at drag start. */}
      {isDragActive && group.tasks.length === 0 && droppable ? (
        <div className="px-3 py-1 text-xs text-neutral-400 dark:text-neutral-600">
          Drop here
        </div>
      ) : null}
      {/* The section is what knows whether a completion empties it, so the
          count is published here rather than threaded through SortableRow. */}
      <SectionOpenProvider tasks={group.tasks}>
        {group.tasks.map((t) =>
          sortableIds ? (
            <SortableRow
              key={t.id}
              task={t}
              projects={projects}
              hideStatusBadge={hideStatusBadge}
            />
          ) : (
            <div key={t.id} className="py-px">
              <TaskItem task={t} projects={projects} hideStatusBadge={hideStatusBadge} />
            </div>
          )
        )}
      </SectionOpenProvider>
    </div>
  );

  const showHeader = !hideHeader && !!group.label;
  const headerInner = (
    <>
      <SectionCaret collapsed={collapsed} />
      {group.color ? <SectionDot color={group.color} /> : null}
      <span className="truncate">{group.label}</span>
      <SectionCount value={group.count} />
    </>
  );
  // The pinned band needs the section's own left padding so the label lines up
  // with the row titles under it, and `-mx` so its background reaches past
  // them — a header narrower than the rows it covers lets them show at the
  // edges as they scroll under.
  const headerClass = `${sectionHeaderClass(compact)} ${STICKY_SECTION_HEADER} ${
    compact ? "mb-0.5" : "mb-1"
  } -mx-1 px-1`;

  return (
    <section className={`group ${compact ? "mb-2.5" : "mb-6"}`}>
      {showHeader ? (
        onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            className={`${headerClass} text-left transition-colors hover:text-neutral-900 dark:hover:text-neutral-100`}
          >
            {headerInner}
          </button>
        ) : (
          <h2 className={headerClass}>
            {headerInner}
          </h2>
        )
      ) : null}
      {!collapsed ? (
        sortableIds ? (
          <SortableContext
            id={dropId(group.key)}
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            {body}
          </SortableContext>
        ) : (
          body
        )
      ) : null}
      {/* Hidden (not unmounted) while a drag is active: unmounting collapses
          the composer's row, shifting the whole list under the pointer the
          moment a drag starts — and invalidating the droppable rects dnd-kit
          measured at drag start. `invisible` keeps the layout box. */}
      {!collapsed && quickAdd ? (
        <div className={isDragActive ? "invisible" : undefined}>
          <InlineTaskComposer seed={seedFromDrop(group.drop)} />
        </div>
      ) : null}
    </section>
  );
}

function SortableRow({
  task,
  projects,
  hideStatusBadge,
}: {
  task: Task;
  projects?: Project[];
  hideStatusBadge: boolean;
}) {
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
     
      suppressHydrationWarning
      {...attributes}
      {...listeners}
      className={`group/row flex touch-manipulation items-stretch ${
        isDragging ? NO_LINK_NAV_WHILE_DRAGGING : ""
      }`}
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
        <TaskItem task={task} projects={projects} hideStatusBadge={hideStatusBadge} />
      </div>
    </div>
  );
}
