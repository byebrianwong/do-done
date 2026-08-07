"use client";

import { TaskDisplayView } from "@/components/task-display-view";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

export default function DemoCompletedPage() {
  const { tasks, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading />;

  const completed = tasks
    .filter((t) => t.status === "done" && !!t.completed_at)
    .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!));

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
