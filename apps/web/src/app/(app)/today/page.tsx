import { TaskForm } from "@/components/task-form";
import { TaskItem } from "@/components/task-item";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";
import { generateFocusList } from "@do-done/task-engine";

export default async function TodayPage() {
  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: allTasks = [] }, { data: projects = [] }] = await Promise.all([
    tasksApi
      ? tasksApi.list({ limit: 100, offset: 0 })
      : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  const active = allTasks.filter(
    (t) => t.status !== "done" && t.status !== "archived"
  );

  const focusList = generateFocusList(active, 3);
  const focusIds = new Set(focusList.map((t) => t.id));

  const today = new Date().toISOString().split("T")[0];
  const otherToday = active.filter(
    (t) => !focusIds.has(t.id) && t.due_date && t.due_date <= today
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Today
      </h1>

      <TaskForm defaultStatus="todo" />

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
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {otherToday.map((task) => (
              <TaskItem key={task.id} task={task} projects={projects} />
            ))}
          </div>
        </section>
      )}

      {focusList.length === 0 && otherToday.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">
            Nothing scheduled for today. Add a task above.
          </p>
        </div>
      )}
    </div>
  );
}
