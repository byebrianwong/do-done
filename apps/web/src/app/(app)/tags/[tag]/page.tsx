import { decodeTagParam } from "@do-done/shared";
import { TagTasksView } from "@/components/tag-tasks-view";
import {
  getServerTasksApi,
  getServerProjectsApi,
} from "@/lib/supabase/tasks-server";

export default async function TagDetailPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag: raw } = await params;
  // Next has already percent-decoded the segment; `decodeTagParam` is a no-op
  // on an ordinary tag and is here so a double-encoded link doesn't 404
  // silently — it costs nothing and both platforms call the same helper.
  const tag = decodeTagParam(raw);

  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();
  const [{ data: tasks = [] }, { data: projects = [] }] = await Promise.all([
    tasksApi ? tasksApi.listByTag(tag) : Promise.resolve({ data: [] }),
    projectsApi ? projectsApi.list() : Promise.resolve({ data: [] }),
  ]);

  // No notFound() here: a tag isn't a row, so "doesn't exist" and "has no
  // tasks left" are the same state. A link from a task that was just
  // untagged has to land somewhere that explains itself, not on a 404.
  return <TagTasksView tag={tag} tasks={tasks} projects={projects} />;
}
