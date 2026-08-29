import "server-only";

/**
 * A read that failed, as opposed to one that found nothing.
 *
 * Every `TasksApi` / `ProjectsApi` read returns `{ data, error }` and sets
 * `data` to `[]` when it fails. So a page that destructures `data` and drops
 * `error` renders a failed read and an empty account identically — and the
 * empty-state copy then makes a confident claim about the user's own data
 * ("No tasks in your inbox") on the strength of a 401.
 *
 * That is not hypothetical: a Supabase incident rejected every authenticated
 * read with `PGRST303 JWT issued at future`, and the app reported a full
 * account as empty rather than as unreachable. An outage must look like an
 * outage.
 */
export class ReadError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Could not load ${what}`, { cause });
    this.name = "ReadError";
  }
}

/**
 * Unwrap a read, throwing `ReadError` if it failed.
 *
 * Thrown rather than returned so a page cannot forget it: the nearest error
 * boundary (`app/(app)/error.tsx`) renders instead of the page, inside the
 * shell, so the sidebar still works and the failure is legible. `what` names
 * the read for the server log — Next replaces a server error's message with a
 * digest before it reaches the client, so the boundary's own copy is what the
 * user sees.
 */
export function must<T>(
  result: { data: T; error: Error | null },
  what: string
): T {
  if (result.error) throw new ReadError(what, result.error);
  return result.data;
}

/** `must`, awaited — the shape every page's `Promise.all` wants. */
export async function read<T>(
  result: Promise<{ data: T; error: Error | null }>,
  what: string
): Promise<T> {
  return must(await result, what);
}

/**
 * PostgREST's code for "no rows" out of `.single()`.
 *
 * `getById` asks for a single row, and PostgREST reports *finding nothing* as
 * an error rather than as an empty result. So a task that genuinely does not
 * exist arrives shaped exactly like a task we failed to fetch, and `read`
 * would throw for both — turning a 404 into "couldn't load". This constant is
 * where those two are told apart.
 */
const NO_ROWS = "PGRST116";

/**
 * Unwrap a single-row read: `null` when the row is genuinely absent, a throw
 * when the read failed. The detail pages turn the `null` into `notFound()`.
 */
export function mustRow<T>(
  result: { data: T | null; error: Error | null },
  what: string
): T | null {
  const { data, error } = result;
  if (!error) return data;
  if ((error as { code?: string }).code === NO_ROWS) return null;
  throw new ReadError(what, error);
}

/** `mustRow`, awaited. */
export async function readRow<T>(
  result: Promise<{ data: T | null; error: Error | null }>,
  what: string
): Promise<T | null> {
  return mustRow(await result, what);
}
