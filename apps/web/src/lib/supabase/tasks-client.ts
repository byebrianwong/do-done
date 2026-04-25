import { TasksApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";

export async function getClientTasksApi() {
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new TasksApi(supabase, user?.id);
}
