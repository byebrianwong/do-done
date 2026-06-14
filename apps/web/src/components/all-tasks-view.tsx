"use client";

import { useMemo } from "react";
import type { Project, Task } from "@do-done/shared";
import { useDisplayConfig } from "@/lib/use-display-config";
import { DisplayMenu } from "./display-menu";
import { DraggableTaskGroups } from "./draggable-task-groups-client";

export interface AllTasksViewProps {
  tasks: Task[];
  projects: Project[];
}

export function AllTasksView({ tasks, projects }: AllTasksViewProps) {
  const { config, setConfig, reset, isDefault } = useDisplayConfig("all");

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) for (const tag of t.tags) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          All tasks
        </h1>
        <DisplayMenu
          config={config}
          onChange={setConfig}
          onReset={reset}
          isDefault={isDefault}
          projects={projects}
          availableTags={availableTags}
        />
      </div>
      <p className="mb-6 text-sm text-neutral-500">{tasks.length} total.</p>

      {tasks.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">No tasks yet.</p>
        </div>
      ) : (
        <DraggableTaskGroups tasks={tasks} projects={projects} config={config} />
      )}
    </div>
  );
}
