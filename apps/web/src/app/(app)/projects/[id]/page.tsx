import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskItem } from "@/components/task-item";
import { TaskForm } from "@/components/task-form";
import { ProjectActions } from "./project-actions";
import { createServerSupabase } from "@/lib/supabase/server";
import { ProjectsApi, TasksApi } from "@do-done/api-client";

export default async function ProjectDetailPage({
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

  const [{ data: project, error }, { data: tasks }, { data: allProjects }] =
    await Promise.all([
      projectsApi.getById(id),
      tasksApi.list({ project_id: id, limit: 100, offset: 0 }),
      projectsApi.list(),
    ]);

  if (error || !project) {
    notFound();
  }

  const open = tasks.filter(
    (t) => t.status !== "done" && t.status !== "archived"
  );
  const done = tasks.filter((t) => t.status === "done");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs">
        <Link
          href="/projects"
          className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          ← Projects
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-4 w-4 shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
          />
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {project.icon ? `${project.icon} ` : ""}
            {project.name}
          </h1>
        </div>
        <ProjectActions project={project} />
      </div>

      <TaskForm defaultStatus="todo" />

      {open.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Open ({open.length})
          </h2>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {open.map((task) => (
              <TaskItem key={task.id} task={task} projects={allProjects} />
            ))}
          </div>
        </section>
      ) : (
        <div className="py-12 text-center">
          <p className="text-sm text-neutral-400">
            No open tasks. Add one above.
          </p>
        </div>
      )}

      {done.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Done ({done.length})
          </h2>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {done.map((task) => (
              <TaskItem key={task.id} task={task} projects={allProjects} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
