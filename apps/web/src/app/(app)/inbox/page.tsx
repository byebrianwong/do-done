import { TaskForm } from "@/components/task-form";
import { TaskDisplayView } from "@/components/task-display-view";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";

export default async function InboxPage() {
  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: tasks = [] }, { data: projects = [] }] = await Promise.all([
    tasksApi
      ? tasksApi.list({ status: "inbox", limit: 50, offset: 0 })
      : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Inbox
      </h1>

      <TaskForm defaultStatus="inbox" />

      <div className="mt-4">
        <TaskDisplayView
          viewKey="inbox"
          tasks={tasks}
          projects={projects}
          emptyText="No tasks in your inbox. Add one above to get started."
        />
      </div>
    </div>
  );
}
