import { TagsIndex } from "@/components/tags-index";
import { read } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";

export default async function TagsPage() {
  const { tasksApi } = await requireServerApis();
  const tags = await read(tasksApi.listTags(), "your tags");

  return <TagsIndex tags={tags} />;
}
