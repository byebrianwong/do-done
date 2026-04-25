import "server-only";
import { TasksApi, ProjectsApi } from "@do-done/api-client";
import { createServerSupabase } from "./server";

export async function getServerTasksApi() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return new TasksApi(supabase, user.id);
}

export async function getServerProjectsApi() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return new ProjectsApi(supabase, user.id);
}
