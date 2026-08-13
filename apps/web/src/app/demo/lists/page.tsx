"use client";

import Link from "next/link";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";
import { ProjectIcon } from "@/components/project-icon";
import { isGot, listSubline, splitProjects } from "@do-done/shared";

export default function DemoListsPage() {
  // `items`, not `tasks` — the sandbox's two halves of the same store. See
  // `useDemoData`.
  const { items, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading rows={3} />;

  const { lists } = splitProjects(projects);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Lists
      </h1>
      <p className="mb-6 text-xs text-neutral-500">
        Things to buy. None of these show up in Today, Inbox or All tasks.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {lists.map((list) => {
          const mine = items.filter((t) => t.project_id === list.id);
          const summary = {
            open: mine.filter((t) => !isGot(t)).length,
            got: mine.filter(isGot).length,
            elsewhere: 0,
          };
          return (
            <Link
              key={list.id}
              href={`/demo/lists/${list.id}`}
              className="group rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: list.color }}
                >
                  <ProjectIcon icon={list.icon} size={13} />
                </span>
                <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {list.name}
                </h2>
              </div>
              <p className="mt-3 text-xs text-neutral-500">
                {listSubline(summary)}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
