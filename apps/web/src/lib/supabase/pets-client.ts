import { PetsApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";

export async function getClientPetsApi() {
  const supabase = createClientSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return new PetsApi(supabase, user?.id);
}
