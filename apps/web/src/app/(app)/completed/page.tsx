import { TaskDisplayView } from "@/components/task-display-view";
import { read } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";

export default async function CompletedPage() {
  const { tasksApi, projectsApi } = await requireServerApis();
  const [completed, projects] = await Promise.all([
    read(tasksApi.listCompleted({ limit: 200 }), "your completed tasks"),
    read(projectsApi.list(), "your projects"),
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
