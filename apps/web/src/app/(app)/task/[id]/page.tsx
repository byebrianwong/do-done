import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskItem } from "@/components/task-item";
import { createServerSupabase } from "@/lib/supabase/server";
import { ProjectsApi, TasksApi } from "@do-done/api-client";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const projectsApi = new ProjectsApi(supabase, user.id);
  const tasksApi = new TasksApi(supabase, user.id);

  const [{ data: task, error }, { data: subtasks }, { data: projects }] =
    await Promise.all([
      tasksApi.getById(id),
      tasksApi.listSubtasks(id),
      projectsApi.list(),
    ]);

  if (error || !task) {
    notFound();
  }

  return (
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
              <TaskItem key={sub.id} task={sub} projects={projects} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
