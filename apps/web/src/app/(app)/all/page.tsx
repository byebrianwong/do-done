import { TaskItem } from "@/components/task-item";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";
import { STATUS_CONFIG, STATUS_ORDER } from "@do-done/shared";
import type { Task, TaskStatus } from "@do-done/shared";

export default async function AllTasksPage() {
  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: tasks = [] }, { data: projects = [] }] = await Promise.all([
    tasksApi
      ? tasksApi.list({ limit: 500, offset: 0 })
      : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  // Group by status, preserving the canonical lifecycle order.
  const groups = new Map<TaskStatus, Task[]>();
  for (const t of tasks) {
    const list = groups.get(t.status) ?? [];
    list.push(t);
    groups.set(t.status, list);
  }

  const ordered = STATUS_ORDER.filter((s) => (groups.get(s)?.length ?? 0) > 0);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        All tasks
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Every task, grouped by status. {tasks.length} total.
      </p>

      {ordered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">No tasks yet.</p>
        </div>
      ) : (
        ordered.map((status) => {
          const cfg = STATUS_CONFIG[status];
          const list = groups.get(status) ?? [];
          return (
            <section key={status} className="mb-6">
              <h2
                className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"
                style={{ color: cfg.color }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: cfg.color }}
                />
                {cfg.label}
                <span className="text-neutral-400">({list.length})</span>
              </h2>
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {list.map((task) => (
                  <TaskItem key={task.id} task={task} projects={projects} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
