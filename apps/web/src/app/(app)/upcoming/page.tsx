import { TaskItem } from "@/components/task-item";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";
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
    tasksApi ? tasksApi.getUpcoming(7) : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.due_date) continue;
    const list = groups.get(task.due_date) ?? [];
    list.push(task);
    groups.set(task.due_date, list);
  }
  const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Upcoming
      </h1>

      {sortedGroups.length > 0 ? (
        <div className="space-y-6">
          {sortedGroups.map(([date, dayTasks]) => (
            <section key={date}>
              <h2 className="mb-2 border-b border-neutral-100 pb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:border-neutral-800">
                {formatDayHeading(date)}
              </h2>
              <div className="space-y-0.5">
                {dayTasks.map((task) => (
                  <TaskItem key={task.id} task={task} projects={projects} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">
            No upcoming tasks in the next 7 days.
          </p>
        </div>
      )}
    </div>
  );
}
