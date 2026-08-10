import { TagsIndex } from "@/components/tags-index";
import { getServerTasksApi } from "@/lib/supabase/tasks-server";

export default async function TagsPage() {
  const tasksApi = await getServerTasksApi();
  const { data: tags = [] } = tasksApi
    ? await tasksApi.listTags()
    : { data: [] };

  return <TagsIndex tags={tags} />;
}
