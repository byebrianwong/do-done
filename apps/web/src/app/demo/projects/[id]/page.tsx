"use client";

import Link from "next/link";
import { use } from "react";
import { QuickAddBar } from "@/components/quick-add-bar";
import { TaskDisplayView } from "@/components/task-display-view";
import { ProjectOpenProvider } from "@/lib/task-row-behavior";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";
import { ProjectLabel } from "@/components/project-icon";

export default function DemoProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { tasks, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading />;

  const project = projects.find((p) => p.id === id);
  if (!project) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center">
        <p className="text-sm text-neutral-500">That project is gone.</p>
        <Link
          href="/demo/projects"
          className="mt-2 inline-block text-sm font-medium text-indigo-500 hover:text-indigo-600"
        >
          ← Projects
        </Link>
      </div>
    );
  }

  const projectTasks = tasks
    .filter((t) => t.project_id === id)
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs">
        <Link
          href="/demo/projects"
          className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          ← Projects
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <span
          className="h-4 w-4 shrink-0 rounded-full"
          style={{ backgroundColor: project.color }}
        />
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          <ProjectLabel
            icon={project.icon}
            name={project.name}
            size={22}
            color={project.color}
          />
        </h1>
      </div>

      <QuickAddBar seed={{ status: "not_started", project_id: id }} />

      <div className="mt-4">
        {/* Same as the real project page — the demo is the app, so the
            finished-project burst has to work here too. */}
        <ProjectOpenProvider tasks={projectTasks}>
          <TaskDisplayView
            viewKey="project"
            tasks={projectTasks}
            projects={projects}
            emptyText="No tasks yet. Add one above."
          />
        </ProjectOpenProvider>
      </div>
    </div>
  );
}
