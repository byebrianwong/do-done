"use client";

import { useMemo } from "react";
import {
  isManualSort,
  todayLocalISO,
  type Project,
  type Task,
} from "@do-done/shared";
import { todayUniverse } from "@do-done/task-engine";
import { CuratedDisplayView } from "./curated-display-view";
import { DraggableToday } from "./draggable-today-client";
import { TaskForm } from "./task-form";

export function TodayView({
  allTasks,
  projects,
}: {
  allTasks: Task[];
  projects: Project[];
}) {
  // The set of tasks that belong on Today: overdue, the focus picks (which now
  // include any task the user has pinned in), and anything scheduled for today.
  // This is the universe the Display menu groups/sorts/filters over.
  const universe = useMemo(
    () => todayUniverse(allTasks, todayLocalISO()),
    [allTasks]
  );

  return (
    <CuratedDisplayView
      viewKey="today"
      title="Today"
      allTasks={universe}
      projects={projects}
      beforeContent={<TaskForm defaultStatus="not_started" />}
      curatedWhen={(c) => c.group === "none" && isManualSort(c)}
      renderCurated={(tasks) => (
        <DraggableToday tasks={tasks} projects={projects} />
      )}
    />
  );
}
