import { ProjectsApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";
import { demoProjectsApi } from "@/lib/demo/api";
import { isDemoMode } from "@/lib/demo/mode";

/** The browser's ProjectsApi — or the sandbox's, on a `/demo` route. */
export async function getClientProjectsApi(): Promise<ProjectsApi> {
  if (isDemoMode()) return demoProjectsApi;
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new ProjectsApi(supabase, user?.id);
}

/** Synchronous variant, for callers that already hold the owning user's id. */
export function getProjectsApiFor(userId: string | undefined): ProjectsApi {
  if (isDemoMode()) return demoProjectsApi;
  return new ProjectsApi(createClientSupabase(), userId);
}
