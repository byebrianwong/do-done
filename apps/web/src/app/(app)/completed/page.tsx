import { TaskDisplayView } from "@/components/task-display-view";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";

export default async function CompletedPage() {
  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: completed = [] }, { data: projects = [] }] = await Promise.all([
    tasksApi
      ? tasksApi.listCompleted({ limit: 200 })
      : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <TaskDisplayView
        viewKey="completed"
        title="Completed"
        subtitle={
          completed.length === 0
            ? "Nothing here yet — complete a task and it’ll land here."
            : "Click a task to reopen it."
        }
        tasks={completed}
        projects={projects}
        quickAdd={false}
        emptyText="Nothing here yet — complete a task and it’ll land here."
      />
    </div>
  );
}
