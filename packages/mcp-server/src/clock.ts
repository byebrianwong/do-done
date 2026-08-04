// "Today" for the MCP server.
//
// The stdio transport runs on the user's own machine, where the process clock
// is their clock. The hosted transport runs on a deployed server in UTC, where
// it is not: for a user behind UTC, `new Date()` rolls over to tomorrow in the
// middle of their evening, and every "what's on today" answer shifts a day.
// So the day is always resolved through the user's `user_preferences.timezone`.

import type { SupabaseClient } from "@do-done/api-client";
import { UserPrefsApi } from "@do-done/api-client";
import { todayISOInZone, todayLocalISO } from "@do-done/shared";

export interface Today {
  /** The user's current calendar day, `YYYY-MM-DD`. */
  todayISO: string;
  /** The IANA zone it was resolved in, for display. */
  timezone: string;
}

export interface Clock {
  now(): Promise<Today>;
}

/**
 * A clock bound to one user's timezone preference.
 *
 * The *timezone* is fetched once and cached — it's a preference, not a fact
 * about the moment. The *day* is recomputed on every call, because the stdio
 * server is a long-lived process that will sit through midnight and must not
 * keep answering with yesterday.
 */
export function createClock(
  supabase: SupabaseClient,
  userId: string
): Clock {
  const prefs = new UserPrefsApi(supabase, userId);
  let timezonePromise: Promise<string | null> | null = null;

  const timezone = async (): Promise<string | null> => {
    // A failed lookup is cached too: retrying the same broken query on every
    // tool call would just add latency to an already-degraded path.
    timezonePromise ??= prefs
      .get()
      .then(({ data, error }) => {
        if (error) {
          console.error(`[do-done] timezone lookup failed: ${error.message}`);
          return null;
        }
        return data?.timezone ?? null;
      })
      .catch((err: unknown) => {
        console.error(`[do-done] timezone lookup threw: ${String(err)}`);
        return null;
      });
    return timezonePromise;
  };

  return {
    async now() {
      const zone = await timezone();
      // No preference (or an unreachable prefs row) → fall back to the process
      // clock, which is right on stdio and no worse than what we had on HTTP.
      if (!zone) {
        return {
          todayISO: todayLocalISO(),
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local time",
        };
      }
      return { todayISO: todayISOInZone(zone), timezone: zone };
    },
  };
}
