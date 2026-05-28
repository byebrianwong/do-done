import { DraggableAllTasks } from "@/components/draggable-all-tasks-client";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";

export default async function AllTasksPage() {
  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: tasks = [] }, { data: projects = [] }] = await Promise.all([
    tasksApi
      ? tasksApi.list({ limit: 500, offset: 0 })
      : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        All tasks
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Every task, grouped by status — drag between groups to change status.
        {" "}{tasks.length} total.
      </p>

      {tasks.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">No tasks yet.</p>
        </div>
      ) : (
        <DraggableAllTasks tasks={tasks} projects={projects} />
      )}
    </div>
  );
}
