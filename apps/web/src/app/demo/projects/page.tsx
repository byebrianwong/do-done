"use client";

import Link from "next/link";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";
import { ProjectLabel } from "@/components/project-icon";

const CLOSED = new Set(["done", "cancelled", "archived"]);

export default function DemoProjectsPage() {
  const { tasks, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading rows={4} />;

  const withCounts = projects.map((p) => {
    const mine = tasks.filter((t) => t.project_id === p.id);
    return {
      ...p,
      task_count: mine.length,
      open_count: mine.filter((t) => !CLOSED.has(t.status)).length,
    };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Projects
      </h1>

      <div className="grid gap-3 sm:grid-cols-2">
        {withCounts.map((p) => (
          <Link
            key={p.id}
            href={`/demo/projects/${p.id}`}
            className="group rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
          >
            <div className="flex items-center gap-2.5">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: p.color }}
              />
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                <ProjectLabel icon={p.icon} name={p.name} size={14} />
              </h2>
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
              <span>
                <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                  {p.open_count}
                </span>{" "}
                open
              </span>
              <span className="h-1 w-1 rounded-full bg-neutral-300" />
              <span>{p.task_count} total</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
