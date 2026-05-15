import { DraggableUpcoming } from "@/components/draggable-upcoming-client";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";
import { taskDate } from "@do-done/api-client";
import type { Task } from "@do-done/shared";

function formatDayHeading(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return "Today";
  if (date.getTime() === tomorrow.getTime()) return "Tomorrow";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default async function UpcomingPage() {
  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: tasks = [] }, { data: projects = [] }] = await Promise.all([
    tasksApi ? tasksApi.getUpcoming(30) : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  // Group by effective date — when_date wins, due_date is fallback.
  // Tasks with neither (bucket-only or unscheduled) don't show in Upcoming.
  const byDate = new Map<string, Task[]>();
  for (const task of tasks) {
    const d = taskDate(task);
    if (!d) continue;
    const list = byDate.get(d) ?? [];
    list.push(task);
    byDate.set(d, list);
  }

  // Always seed the next 14 days as drop targets, even if empty, so the user
  // has somewhere to drag a task to.
  const groups: Array<{ date: string; label: string; tasks: Task[] }> = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split("T")[0];
    groups.push({
      date: key,
      label: formatDayHeading(key),
      tasks: byDate.get(key) ?? [],
    });
    byDate.delete(key);
  }
  // Add any remaining future dates (15+ days out) that have tasks.
  const remaining = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [date, dayTasks] of remaining) {
    groups.push({ date, label: formatDayHeading(date), tasks: dayTasks });
  }

  const hasAny = groups.some((g) => g.tasks.length > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Upcoming
      </h1>

      {hasAny ? (
        <DraggableUpcoming groups={groups} projects={projects} />
      ) : (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">
            No upcoming tasks. Schedule one to see it here.
          </p>
        </div>
      )}
    </div>
  );
}
