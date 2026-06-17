"use client";

import { useMemo } from "react";
import { isManualSort, isOverdue, type Project, type Task } from "@do-done/shared";
import { taskDate } from "@do-done/api-client";
import { generateFocusList } from "@do-done/task-engine";
import { CuratedDisplayView } from "./curated-display-view";
import { OverdueSection } from "./overdue-section";
import { SortableTaskList } from "./sortable-task-list-client";
import { TaskForm } from "./task-form";
import { TaskItem } from "./task-item";

/**
 * The set of tasks that belong on Today: anything overdue, the top focus picks
 * (urgency-ranked across all active tasks), and anything scheduled for today.
 * This is the universe the Display menu groups/sorts/filters over.
 */
function todayUniverse(allTasks: Task[]): Task[] {
  const active = allTasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  );
  const today = new Date().toISOString().split("T")[0];
  const overdue = active.filter(isOverdue);
  const overdueIds = new Set(overdue.map((t) => t.id));
  const fresh = active.filter((t) => !overdueIds.has(t.id));
  const focus = generateFocusList(fresh, 3);
  const focusIds = new Set(focus.map((t) => t.id));
  const otherToday = fresh.filter((t) => {
    if (focusIds.has(t.id)) return false;
    const d = taskDate(t);
    return d !== null && d <= today;
  });
  return [...overdue, ...focus, ...otherToday];
}

export function TodayView({
  allTasks,
  projects,
}: {
  allTasks: Task[];
  projects: Project[];
}) {
  const universe = useMemo(() => todayUniverse(allTasks), [allTasks]);

  return (
    <CuratedDisplayView
      viewKey="today"
      title="Today"
      allTasks={universe}
      projects={projects}
      beforeContent={<TaskForm defaultStatus="not_started" />}
      curatedWhen={(c) => c.group === "none" && isManualSort(c)}
      renderCurated={(tasks) => <CuratedToday tasks={tasks} projects={projects} />}
    />
  );
}

/** The hand-designed Today layout: overdue · focus · other, over a (filtered) set. */
function CuratedToday({
  tasks,
  projects,
}: {
  tasks: Task[];
  projects: Project[];
}) {
  const overdue = tasks.filter(isOverdue);
  const overdueIds = new Set(overdue.map((t) => t.id));
  const fresh = tasks.filter((t) => !overdueIds.has(t.id));
  const focusList = generateFocusList(fresh, 3);
  const focusIds = new Set(focusList.map((t) => t.id));
  const otherToday = fresh.filter((t) => !focusIds.has(t.id));

  if (overdue.length === 0 && focusList.length === 0 && otherToday.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-neutral-400">
          Nothing scheduled for today. Add a task above.
        </p>
      </div>
    );
  }

  return (
    <>
      <OverdueSection tasks={overdue} projects={projects} />

      {focusList.length > 0 && (
        <section className="mb-8">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
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
              Focus
            </h2>
            <div className="space-y-0.5">
              {focusList.map((task) => (
                <TaskItem key={task.id} task={task} projects={projects} />
              ))}
            </div>
          </div>
        </section>
      )}

      {otherToday.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Other tasks
          </h2>
          <SortableTaskList tasks={otherToday} projects={projects} />
        </section>
      )}
    </>
  );
}
