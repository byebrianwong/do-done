"use client";

import Link from "next/link";
import { use } from "react";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";
import { ProjectIcon } from "@/components/project-icon";
import { ProjectActions } from "@/components/project-actions";
import { isListProject } from "@do-done/shared";
import { ListView } from "@/app/(app)/lists/[id]/list-view";

export default function DemoListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { items, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading rows={6} />;

  const list = projects.find((p) => p.id === id);
  if (!list || !isListProject(list)) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="text-sm text-neutral-500">That list doesn&apos;t exist.</p>
        <Link href="/demo/lists" className="text-xs text-indigo-500">
          ← Lists
        </Link>
      </div>
    );
  }

  const mine = items.filter((t) => t.project_id === id);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs">
        <Link
          href="/demo/lists"
          className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          ← Lists
        </Link>
      </div>

      <div className="mb-5 flex items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: list.color }}
        >
          <ProjectIcon icon={list.icon} size={16} />
        </span>
        <h1 className="truncate text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {list.name}
        </h1>
        <div className="ml-auto shrink-0">
          <ProjectActions project={list} />
        </div>
      </div>

      {/*
        The real component, against the sandbox's API — the same trade the rest
        of the demo makes. `getClientTasksApi()` resolves to `demoTasksApi` on a
        /demo route, so nothing in ListView knows where it is.
      */}
      <ListView list={list} initialItems={mine} />
    </div>
  );
}
