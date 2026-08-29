import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskItem } from "@/components/task-item";
import { TaskRowBehaviorProvider } from "@/lib/task-row-behavior";
import { read, readRow } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tasksApi, projectsApi } = await requireServerApis();

  const [task, subtasks, projects] = await Promise.all([
    readRow(tasksApi.getById(id), "this task"),
    read(tasksApi.listSubtasks(id), "this task's subtasks"),
    read(projectsApi.list(), "your projects"),
  ]);

  // Only a genuinely absent row is a 404. A read that *failed* has already
  // thrown, because `error || !task` here told someone their task did not
  // exist on the strength of a 401 — a link they had just been handed.
  if (!task) notFound();

  return (
    // This page IS the task, so ticking it off must not collapse the row out
    // from under the reader. It stays, with its completed styling.
    <TaskRowBehaviorProvider keepsCompleted>
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs">
        <Link
          href="/all"
          className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          ← All tasks
        </Link>
      </div>

      <h1 className="mb-4 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        Task
      </h1>

      <div className="rounded-xl border border-neutral-200 p-1 dark:border-neutral-800">
        <TaskItem task={task} projects={projects} />
      </div>

      {subtasks.length > 0 ? (
        <div className="mt-8">
          <h2 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            Subtasks
          </h2>
          <div>
            {subtasks.map((sub) => (
              // The parent is the task rendered right above under the "Task"
              // heading, so the per-row "↳ parent" breadcrumb would be pure
              // redundancy here — suppress it.
              <TaskItem
                key={sub.id}
                task={sub}
                projects={projects}
                parentTask={task}
                hideParentRef
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
    </TaskRowBehaviorProvider>
  );
}
