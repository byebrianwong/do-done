import { UserPrefsApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";

export async function getClientUserPrefsApi() {
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new UserPrefsApi(supabase, user?.id);
}
