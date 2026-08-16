import { TasksApi } from "@do-done/api-client";
import { createClientSupabase } from "./client";
import { demoTasksApi } from "@/lib/demo/api";
import { isDemoMode } from "@/lib/demo/mode";
import { announceAutoSync } from "@/lib/auto-sync-events";

/**
 * Wrap `create`/`update` so a change the status ↔ schedule rule made on the
 * user's behalf gets announced.
 *
 * Here rather than at the call sites because there are fifteen of them and
 * this is the one place they all get their API from — the same argument that
 * made this module demo mode's seam. A component that writes a task keeps
 * knowing nothing about either.
 *
 * A Proxy rather than a subclass: `TasksApi`'s methods call each other
 * (`complete` goes through `update`), and a subclass would announce the same
 * event twice for one write.
 */
function announcing(api: TasksApi): TasksApi {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== "create" && prop !== "update") return value;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        (value as (...a: unknown[]) => Promise<{ autoSync?: { notice: string } }>)
          .apply(target, args)
          .then((result) => {
            announceAutoSync(result?.autoSync?.notice);
            return result;
          });
    },
  });
}

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
  return announcing(new TasksApi(supabase, user?.id));
}

/**
 * Same, for callers that already hold the owning user's id and want the API
 * synchronously — the task editor builds one per open task inside a `useMemo`,
 * where an await would mean a null API on the first render.
 */
export function getTasksApiFor(userId: string | undefined): TasksApi {
  if (isDemoMode()) return demoTasksApi;
  return announcing(new TasksApi(createClientSupabase(), userId));
}
