"use client";

import { QuickAddBar } from "@/components/quick-add-bar";
import { TaskDisplayView } from "@/components/task-display-view";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

export default function DemoInboxPage() {
  const { tasks, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading />;

  const inbox = tasks
    .filter((t) => t.status === "inbox")
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Inbox
      </h1>

      <QuickAddBar seed={{ status: "inbox" }} />

      <div className="mt-4">
        <TaskDisplayView
          viewKey="inbox"
          tasks={inbox}
          projects={projects}
          emptyText="No tasks in your inbox. Add one above to get started."
        />
      </div>
    </div>
  );
}
