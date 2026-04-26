import Link from "next/link";
import { NewProjectButton, NewProjectMount } from "./projects-list-client";
import { createServerSupabase } from "@/lib/supabase/server";
import { ProjectsApi } from "@do-done/api-client";

export default async function ProjectsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const projects = new ProjectsApi(supabase, user.id);
  const { data } = await projects.listWithCounts();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Projects
        </h1>
        <NewProjectButton />
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-neutral-200 py-16 text-center dark:border-neutral-800">
          <p className="text-sm text-neutral-500">No projects yet.</p>
          <p className="mt-1 text-xs text-neutral-400">
            Create one to organize your tasks.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="group rounded-xl border border-neutral-200 bg-white p-4 transition-all hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {p.icon ? `${p.icon} ` : ""}
                    {p.name}
                  </h2>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
                <span>
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300">
                    {p.open_count}
                  </span>{" "}
                  open
                </span>
                <span className="h-1 w-1 rounded-full bg-neutral-300" />
                <span>
                  {p.task_count} total
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <NewProjectMount />
    </div>
  );
}
