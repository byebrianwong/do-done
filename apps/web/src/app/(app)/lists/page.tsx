import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { ProjectsApi, TasksApi } from "@do-done/api-client";
import { listSubline } from "@do-done/shared";
import { ProjectIcon } from "@/components/project-icon";
import { NewListButton, NewListMount } from "./lists-client";

export default async function ListsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Two reads rather than one join: the counts come from the shopping-list
  // side of the isolation (`TasksApi.listCounts` reads only items) and the
  // lists themselves from the project side. A single query would have to
  // remember which side of that line each row falls on.
  const [{ lists }, { data: counts }] = await Promise.all([
    new ProjectsApi(supabase, user.id).listByKind(),
    new TasksApi(supabase, user.id).listCounts(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Lists
        </h1>
        <NewListButton />
      </div>

      {lists.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-neutral-200 py-16 text-center dark:border-neutral-800">
          <p className="text-sm text-neutral-500">No lists yet.</p>
          <p className="mt-1 text-xs text-neutral-400">
            Groceries, Amazon, the hardware store — things to buy, kept out of
            your tasks.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {lists.map((list) => {
            const count = counts.get(list.id) ?? { open: 0, got: 0 };
            return (
              <Link
                key={list.id}
                href={`/lists/${list.id}`}
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
                {/*
                  `listSubline` rather than a number: an empty shopping list is
                  its normal resting state, so it says "Nothing on it" instead
                  of printing a 0 that reads as an achievement.
                */}
                <p className="mt-3 text-xs text-neutral-500">
                  {listSubline({ ...count, elsewhere: 0 })}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <NewListMount />
    </div>
  );
}
