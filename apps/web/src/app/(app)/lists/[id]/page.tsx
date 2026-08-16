import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { AisleTermsApi, ProjectsApi, TasksApi } from "@do-done/api-client";
import { isListProject } from "@do-done/shared";
import { ProjectIcon } from "@/components/project-icon";
import { ProjectActions } from "@/components/project-actions";
import { ListView } from "./list-view";

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const projectsApi = new ProjectsApi(supabase, user.id);
  const tasksApi = new TasksApi(supabase, user.id);

  const [{ data: list, error }, { data: items }, { data: memory }] =
    await Promise.all([
      projectsApi.getById(id),
      // `listItems` is the deliberate opt-in — the one read on this surface
      // that asks for the rows every other read in the app filters out.
      tasksApi.listItems(id),
      // Never fails loudly: a memory that doesn't load degrades to the
      // lexicon's guess, which is a good answer.
      new AisleTermsApi(supabase, user.id).load(),
    ]);

  if (error || !list) notFound();

  // A project reached through /lists is a wrong URL rather than a missing one,
  // so it redirects instead of 404ing. This is reachable in practice: converting
  // a list back into a project leaves every link anyone had pointing here.
  if (!isListProject(list)) redirect(`/projects/${id}`);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs">
        <Link
          href="/lists"
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
        {/* The list's own name, icon and colour were only editable at the
            moment it was created — the same button a project page has fixes
            that, since the form behind it already knows about lists. */}
        <div className="ml-auto shrink-0">
          <ProjectActions project={list} />
        </div>
      </div>

      {/*
        A Map can't cross the server/client boundary, so it is handed over as
        entries and rebuilt in the client component. Serialising it as an
        object would collide on a term like "constructor".
      */}
      <ListView
        list={list}
        initialItems={items}
        memoryEntries={[...memory.entries()]}
      />
    </div>
  );
}
