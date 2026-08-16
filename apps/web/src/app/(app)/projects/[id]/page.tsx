import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskDisplayView } from "@/components/task-display-view";
import { ProjectOpenProvider } from "@/lib/task-row-behavior";
import { QuickAddBar } from "@/components/quick-add-bar";
import { ProjectActions } from "@/components/project-actions";
import { createServerSupabase } from "@/lib/supabase/server";
import { ProjectsApi, TasksApi } from "@do-done/api-client";
import { ProjectIcon } from "@/components/project-icon";

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
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            <ProjectIcon icon={project.icon} size={24} color={project.color} />
            {project.name}
          </h1>
        </div>
        <ProjectActions project={project} />
      </div>

      <QuickAddBar seed={{ status: "not_started", project_id: id }} />

      <div className="mt-4">
        {/* Publishes "how much of this project is left" to the rows inside, so
            the completion that finishes it can say so. It has to wrap the whole
            view rather than a section: this page groups by status by default,
            so the project's last open task is not the last one in any group. */}
        <ProjectOpenProvider tasks={tasks}>
          <TaskDisplayView
            viewKey="project"
            tasks={tasks}
            projects={allProjects}
            emptyText="No tasks yet. Add one above."
          />
        </ProjectOpenProvider>
      </div>
    </div>
  );
}
