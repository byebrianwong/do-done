import "server-only";
import { redirect } from "next/navigation";
import { TasksApi, ProjectsApi } from "@do-done/api-client";
import { createServerSupabase } from "./server";

/**
 * The session and the APIs bound to it, for a page under `(app)`.
 *
 * Every route in that group requires a session, so no session is a redirect
 * rather than a value to branch on. The pages used to hold a nullable API and
 * substitute `{ data: [] }` when it was null, which rendered a signed-out
 * visitor the same empty lists a failed read did — see `lib/read-result.ts`.
 * The proxy normally redirects first; this is the backstop, and it means a
 * page body can read without a null check.
 *
 * One `getUser()` for both APIs. The two factories this replaces each built
 * their own client and made their own auth round-trip, so a page wanting
 * tasks and projects — which is most of them — paid for two.
 */
export async function requireServerApis() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return {
    supabase,
    userId: user.id,
    tasksApi: new TasksApi(supabase, user.id),
    projectsApi: new ProjectsApi(supabase, user.id),
  };
}
