import { PantryApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";
import { demoPantryApi } from "@/lib/demo/api";
import { isDemoMode } from "@/lib/demo/mode";

/**
 * Returns the browser's PantryApi, or the sandbox's on a `/demo` route.
 *
 * The fifth such seam, alongside tasks, projects, prefs and aisle terms. A
 * component that constructed `new PantryApi(createClientSupabase(), …)` inline
 * would read a database the demo has no session for.
 */
export async function getClientPantryApi(): Promise<PantryApi> {
  if (isDemoMode()) return demoPantryApi;
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new PantryApi(supabase, user?.id);
}
