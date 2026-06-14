"use client";

import type { Project, Task } from "@do-done/shared";
import { TaskDisplayView } from "./task-display-view";

export interface AllTasksViewProps {
  tasks: Task[];
  projects: Project[];
}

export function AllTasksView({ tasks, projects }: AllTasksViewProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <TaskDisplayView
        viewKey="all"
        title="All tasks"
        subtitle={`${tasks.length} total.`}
        tasks={tasks}
        projects={projects}
      />
    </div>
  );
}
