import { decodeTagParam } from "@do-done/shared";
import { TagTasksView } from "@/components/tag-tasks-view";
import { read } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";

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

  const { tasksApi, projectsApi } = await requireServerApis();
  const [tasks, projects] = await Promise.all([
    read(tasksApi.listByTag(tag), `tasks tagged #${tag}`),
    read(projectsApi.list(), "your projects"),
  ]);

  // No notFound() here: a tag isn't a row, so "doesn't exist" and "has no
  // tasks left" are the same state. A link from a task that was just
  // untagged has to land somewhere that explains itself, not on a 404.
  // A read that *failed* is a third state and has already thrown above —
  // otherwise an outage would render as "this tag has no tasks".
  return <TagTasksView tag={tag} tasks={tasks} projects={projects} />;
}
