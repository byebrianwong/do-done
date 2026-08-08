import { TasksApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";
import { demoTasksApi } from "@/lib/demo/api";
import { isDemoMode } from "@/lib/demo/mode";

/**
 * The browser's TasksApi — or the sandbox's, on a `/demo` route.
 *
 * This is *the* seam demo mode hangs on. Every write in the web app already
 * came through here, so swapping the object out is all it takes for the whole
 * UI to run against in-memory data: not one component had to learn it might be
 * in a demo. See `lib/demo/mode.ts`.
 */
export async function getClientTasksApi(): Promise<TasksApi> {
  if (isDemoMode()) return demoTasksApi;
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new TasksApi(supabase, user?.id);
}

/**
 * Same, for callers that already hold the owning user's id and want the API
 * synchronously — the task editor builds one per open task inside a `useMemo`,
 * where an await would mean a null API on the first render.
 */
export function getTasksApiFor(userId: string | undefined): TasksApi {
  if (isDemoMode()) return demoTasksApi;
  return new TasksApi(createClientSupabase(), userId);
}
