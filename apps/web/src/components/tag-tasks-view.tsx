"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Project, Task } from "@do-done/shared";
import { DEMO_BASE, isDemoPath } from "@/lib/demo/mode";
import { TaskDisplayView } from "./task-display-view";

export interface TagTasksViewProps {
  tag: string;
  tasks: Task[];
  projects: Project[];
}

/**
 * Every task carrying one tag.
 *
 * Deliberately the ordinary `TaskDisplayView` shell rather than a bespoke
 * list: a tag view is a task list like any other, so sort, group, density and
 * the rest of the Display menu have to work here too. The `viewKey` is the
 * bare `"tag"` — one saved config for the whole surface, not one per tag,
 * because a per-tag key would mean a preference silently reset every time a
 * new tag is coined.
 *
 * A task typed into this view's quick-add would *not* pick the tag up — the
 * seed system has no tag facet — so a row created here would drop straight out
 * of the list it was typed into, exactly the bug the Today bar had. Hence
 * `quickAdd={false}`.
 */
export function TagTasksView({ tag, tasks, projects }: TagTasksViewProps) {
  const pathname = usePathname();
  const base = isDemoPath(pathname) ? DEMO_BASE : "";
  const open = tasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled"
  ).length;

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`${base}/tags`}
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        All tags
      </Link>

      <TaskDisplayView
        viewKey="tag"
        title={`#${tag}`}
        subtitle={
          tasks.length === 0
            ? undefined
            : `${open} open · ${tasks.length} total.`
        }
        tasks={tasks}
        projects={projects}
        emptyText={`Nothing tagged #${tag}.`}
        quickAdd={false}
      />
    </div>
  );
}
