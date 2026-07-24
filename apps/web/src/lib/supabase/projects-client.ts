import { ProjectsApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";

export async function getClientProjectsApi() {
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new ProjectsApi(supabase, user?.id);
}
