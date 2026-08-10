"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { encodeTagParam, type TagSummary } from "@do-done/shared";
import { DEMO_BASE, isDemoPath } from "@/lib/demo/mode";

export interface TagsIndexProps {
  tags: TagSummary[];
}

/**
 * The tags index: every tag the user has, and how much work is under it.
 *
 * Presentational, and shared by the real page and the demo's — the two differ
 * only in where the counts come from (a `TasksApi.listTags()` on the server
 * vs. the sandbox array), which is exactly the split `AllTasksView` already
 * uses.
 *
 * A card leads with its **open** count because that is the number the user is
 * shopping for; the total is the quieter second line, and a tag with nothing
 * left open says so in words rather than showing a bare 0 that reads like a
 * bug.
 */
export function TagsIndex({ tags }: TagsIndexProps) {
  const pathname = usePathname();
  const base = isDemoPath(pathname) ? DEMO_BASE : "";
  const [query, setQuery] = useState("");

  // A filter over the index itself. Tags are cheap to make — a typo in the
  // quick-add bar mints one — so this list gets long in a way the project
  // list never does, and scrolling it is not a way to find "the one about
  // invoices".
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tags.filter((t) => t.tag.toLowerCase().includes(q)) : tags;
  }, [tags, query]);

  const totalOpen = tags.reduce((n, t) => n + t.open_count, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Tags
        </h1>
        {tags.length > 6 ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tags"
            aria-label="Filter tags"
            className="w-44 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-400 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          />
        ) : null}
      </div>

      {tags.length > 0 ? (
        <p className="mb-6 text-sm text-neutral-500">
          {tags.length} {tags.length === 1 ? "tag" : "tags"}
          {totalOpen > 0 ? ` · ${totalOpen} open` : ""}.
        </p>
      ) : null}

      {tags.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-neutral-200 py-16 text-center dark:border-neutral-800">
          <p className="text-sm text-neutral-500">No tags yet.</p>
          <p className="mt-1 text-xs text-neutral-400">
            Type <code className="font-mono text-neutral-500">#errand</code> in
            a task title, or add one from the task editor.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-neutral-400">
            No tag matches “{query.trim()}”.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((t) => (
            <Link
              key={t.tag}
              href={`${base}/tags/${encodeTagParam(t.tag)}`}
              className="group rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-indigo-500 dark:text-indigo-400">
                  #
                </span>
                <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {t.tag}
                </h2>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
                {t.open_count > 0 ? (
                  <>
                    <span>
                      <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                        {t.open_count}
                      </span>{" "}
                      open
                    </span>
                    <span className="h-1 w-1 rounded-full bg-neutral-300" />
                    <span>{t.task_count} total</span>
                  </>
                ) : (
                  <span>
                    All done ·{" "}
                    {t.task_count === 1 ? "1 task" : `${t.task_count} tasks`}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
