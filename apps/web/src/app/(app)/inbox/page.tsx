import { QuickAddBar } from "@/components/quick-add-bar";
import { TaskDisplayView } from "@/components/task-display-view";
import { read } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";

export default async function InboxPage() {
  const { tasksApi, projectsApi } = await requireServerApis();
  const [tasks, projects] = await Promise.all([
    read(
      tasksApi.list({ status: "inbox", limit: 50, offset: 0 }),
      "your inbox"
    ),
    read(projectsApi.list(), "your projects"),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Inbox
      </h1>

      <QuickAddBar seed={{ status: "inbox" }} />

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
