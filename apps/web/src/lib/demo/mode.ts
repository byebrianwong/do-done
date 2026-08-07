/**
 * Demo mode: the whole app running against an in-memory sandbox instead of
 * Supabase.
 *
 * There is no demo account and no demo rows in the database. `tasks.user_id`
 * is a foreign key onto `auth.users`, so anything DB-backed would need a real
 * user per visitor — either a shared login every visitor can trash, or
 * anonymous sign-ins (disabled on the project, and a row per drive-by crawler).
 * A sandbox has neither problem: every visitor gets their own copy, nobody can
 * break anyone else's, and it costs nothing to run.
 *
 * Mode is decided by the URL, not a cookie or a context: `getClientTasksApi()`
 * and friends are called from deep inside components that know nothing about
 * where they're mounted, and the path is the one thing always available to
 * them. Everything under `/demo` is the sandbox; everything else is real.
 */

/** Path prefix every demo route lives under. */
export const DEMO_BASE = "/demo";

/** The demo's stand-in for `user.id` — a fixed uuid, so rows look real. */
export const DEMO_USER_ID = "d0d0d0d0-0000-4000-8000-000000000000";

/** Whether the code calling this is running on a demo route. */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return isDemoPath(window.location.pathname);
}

/** Whether `pathname` belongs to the demo. Exported for the server + tests. */
export function isDemoPath(pathname: string): boolean {
  return pathname === DEMO_BASE || pathname.startsWith(`${DEMO_BASE}/`);
}

/** Prefix an in-app path with the demo base when in demo mode. */
export function demoHref(path: string, demo: boolean): string {
  return demo ? `${DEMO_BASE}${path}` : path;
}
