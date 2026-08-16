import { LocationsApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";
import { demoLocationsApi } from "@/lib/demo/api";
import { isDemoMode } from "@/lib/demo/mode";

/**
 * The browser's LocationsApi — or the sandbox's, on a `/demo` route.
 *
 * Mirrors `getAttachmentsApiFor`: the task editor builds one per open task
 * inside a `useMemo`, where an await would mean a null API on the first render.
 * Routing through here rather than constructing the class at the call site is
 * what keeps demo mode from reaching for a database it has no session for.
 */
export function getLocationsApiFor(userId: string | undefined): LocationsApi {
  if (isDemoMode()) return demoLocationsApi;
  return new LocationsApi(createClientSupabase(), userId);
}

/**
 * Same, for callers that don't already hold the user's id — the places screen
 * and the list-badge provider, neither of which is inside a task.
 */
export async function getClientLocationsApi(): Promise<LocationsApi> {
  if (isDemoMode()) return demoLocationsApi;
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new LocationsApi(supabase, user?.id);
}
