import { AisleTermsApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";
import { demoAisleTermsApi } from "@/lib/demo/api";
import { isDemoMode } from "@/lib/demo/mode";

/**
 * The browser's AisleTermsApi — or the sandbox's, on a `/demo` route.
 *
 * A fourth seam beside tasks, projects and prefs, and for the same reason: a
 * component that built `new AisleTermsApi(createClientSupabase(), …)` inline
 * would silently write to a database the demo has no session for.
 */
export async function getClientAisleTermsApi(): Promise<AisleTermsApi> {
  if (isDemoMode()) return demoAisleTermsApi;
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new AisleTermsApi(supabase, user?.id);
}
