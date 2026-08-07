"use client";

import Link from "next/link";
import { use } from "react";
import { TaskItem } from "@/components/task-item";
import { TaskRowBehaviorProvider } from "@/lib/task-row-behavior";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

export default function DemoTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { tasks, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading rows={2} />;

  const task = tasks.find((t) => t.id === id);
  if (!task) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center">
        <p className="text-sm text-neutral-500">That task is gone.</p>
        <Link
          href="/demo/all"
          className="mt-2 inline-block text-sm font-medium text-indigo-500 hover:text-indigo-600"
        >
          ← All tasks
        </Link>
      </div>
    );
  }

  const subtasks = tasks
    .filter((t) => t.parent_task_id === id)
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    // This page IS the task, so ticking it off must not collapse the row out
    // from under the reader — it stays, wearing its completed styling.
    <TaskRowBehaviorProvider keepsCompleted>
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 text-xs">
          <Link
            href="/demo/all"
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
                <TaskItem
                  key={sub.id}
                  task={sub}
                  projects={projects}
                  parentTask={task}
                  hideParentRef
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </TaskRowBehaviorProvider>
  );
}
