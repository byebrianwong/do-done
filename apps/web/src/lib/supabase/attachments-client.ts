import { AttachmentsApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";
import { demoAttachmentsApi } from "@/lib/demo/api";
import { isDemoMode } from "@/lib/demo/mode";

/**
 * The browser's AttachmentsApi — or the sandbox's, on a `/demo` route.
 *
 * Mirrors `getTasksApiFor`: the task editor builds one per open task inside a
 * `useMemo`, where an await would mean a null API on the first render. Routing
 * through here rather than constructing the class at the call site is what
 * keeps demo mode from reaching for a Storage bucket it has no session for.
 */
export function getAttachmentsApiFor(
  userId: string | undefined
): AttachmentsApi {
  if (isDemoMode()) return demoAttachmentsApi;
  return new AttachmentsApi(createClientSupabase(), userId);
}
