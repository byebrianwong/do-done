import { UserPrefsApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";
import { demoUserPrefsApi } from "@/lib/demo/api";
import { isDemoMode } from "@/lib/demo/mode";

/** The browser's UserPrefsApi — or the sandbox's, on a `/demo` route. */
export async function getClientUserPrefsApi(): Promise<UserPrefsApi> {
  if (isDemoMode()) return demoUserPrefsApi;
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new UserPrefsApi(supabase, user?.id);
}
