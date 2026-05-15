import { TaskItem } from "@/components/task-item";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";
import type { Task } from "@do-done/shared";

type Group = {
  label: string;
  tasks: Task[];
};

function groupByCompletionDay(tasks: Task[]): Group[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 7);

  const buckets = {
    today: [] as Task[],
    yesterday: [] as Task[],
    week: [] as Task[],
    earlier: [] as Task[],
  };

  for (const t of tasks) {
    if (!t.completed_at) {
      buckets.earlier.push(t);
      continue;
    }
    const d = new Date(t.completed_at);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) buckets.today.push(t);
    else if (d.getTime() === yesterday.getTime()) buckets.yesterday.push(t);
    else if (d >= weekStart) buckets.week.push(t);
    else buckets.earlier.push(t);
  }

  const out: Group[] = [];
  if (buckets.today.length) out.push({ label: "Today", tasks: buckets.today });
  if (buckets.yesterday.length)
    out.push({ label: "Yesterday", tasks: buckets.yesterday });
  if (buckets.week.length) out.push({ label: "This week", tasks: buckets.week });
  if (buckets.earlier.length)
    out.push({ label: "Earlier", tasks: buckets.earlier });
  return out;
}

export default async function CompletedPage() {
  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: completed = [] }, { data: projects = [] }] = await Promise.all([
    tasksApi
      ? tasksApi.listCompleted({ limit: 200 })
      : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  const groups = groupByCompletionDay(completed);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Completed
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        {completed.length === 0
          ? "Nothing here yet — complete a task and it’ll land here."
          : "Click a task to reopen it."}
      </p>

      {groups.map((g) => (
        <section key={g.label} className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            {g.label}{" "}
            <span className="ml-1 text-neutral-400">({g.tasks.length})</span>
          </h2>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {g.tasks.map((task) => (
              <TaskItem key={task.id} task={task} projects={projects} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
