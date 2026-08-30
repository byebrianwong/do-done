"use client";

import { useMemo } from "react";
import type { Project, Task } from "@do-done/shared";
import { useDisplayConfig } from "@/lib/use-display-config";
import { useTasksHeldForEditing } from "@/lib/task-editing-hold";
import { DisplayMenu } from "./display-menu";
import { DraggableTaskGroups } from "./draggable-task-groups-client";
import { StickyPageBar } from "./sticky-page-bar";

export interface TaskDisplayViewProps {
  /** Stable key for persistence + per-view defaults (e.g. "all", "inbox"). */
  viewKey: string;
  tasks: Task[];
  projects?: Project[];
  /** Rendered as an <h1> inline with the Display button. Omit to show the
   *  button alone (when the page already renders its own heading). */
  title?: string;
  subtitle?: string;
  /** Shown when there are no tasks at all (vs. none matching the filters). */
  emptyText?: string;
  /** Show the per-section inline "Add task" affordance. Defaults to true; pass
   *  false for read-only lists like Completed. */
  quickAdd?: boolean;
}

/**
 * Reusable view shell: owns a per-view DisplayConfig and renders the Display
 * menu + grouped/sorted/filtered task list. Used by every task list view so
 * sort/group/filter behaves identically across the app.
 */
export function TaskDisplayView({
  viewKey,
  tasks,
  projects,
  title,
  subtitle,
  emptyText = "No tasks yet.",
  quickAdd = true,
}: TaskDisplayViewProps) {
  const { config, setConfig, reset, isDefault } = useDisplayConfig(viewKey);

  // A task whose editor is open keeps its row here even once a save has taken
  // it out of this view's query — the modal is rendered by the row.
  const visibleTasks = useTasksHeldForEditing(tasks);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of visibleTasks) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [visibleTasks]);

  return (
    <StickyPageBar
      title={title}
      subtitle={
        subtitle ? (
          <p className="mb-6 text-sm text-neutral-500">{subtitle}</p>
        ) : null
      }
      actions={
        <DisplayMenu
          config={config}
          onChange={setConfig}
          onReset={reset}
          isDefault={isDefault}
          projects={projects}
          availableTags={availableTags}
        />
      }
    >
      {visibleTasks.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">{emptyText}</p>
        </div>
      ) : (
        <DraggableTaskGroups
          tasks={visibleTasks}
          projects={projects}
          config={config}
          onConfigChange={setConfig}
          quickAdd={quickAdd}
        />
      )}
    </StickyPageBar>
  );
}
