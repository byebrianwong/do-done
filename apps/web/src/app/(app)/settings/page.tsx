import { parseStatusSyncSettings } from "@do-done/shared";
import { createServerSupabase } from "@/lib/supabase/server";
import { CalendarSection } from "./calendar-section";
import { TimezoneSection } from "./timezone-section";
import { StatusSyncSection } from "./status-sync-section";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; disconnected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: sync } = await supabase
    .from("calendar_sync")
    .select("synced_at")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  const isConnected = !!sync;

  // select("*"), not named columns: naming show_calendar_events would error
  // the whole read (timezone included) on a deploy that lands before its
  // migration; with * a missing column is simply absent and defaults apply.
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  const timezone = prefs?.timezone ?? "America/New_York";
  const showEvents = prefs?.show_calendar_events ?? true;
  // Tolerates a prefs row from before the sync migration: missing columns fall
  // back to the defaults, which have both halves off.
  const statusSync = parseStatusSyncSettings(prefs);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Settings
      </h1>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Account
        </h2>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            <span className="text-neutral-400">Email: </span>
            {user?.email}
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Preferences
        </h2>
        <div className="space-y-4">
          <TimezoneSection timezone={timezone} />
          <StatusSyncSection settings={statusSync} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Integrations
        </h2>
        <CalendarSection
          isConnected={isConnected}
          showEvents={showEvents}
          syncedAt={sync?.synced_at ?? null}
          status={
            params.connected
              ? "connected"
              : params.disconnected
                ? "disconnected"
                : params.error
                  ? "error"
                  : null
          }
          errorMessage={params.error ?? null}
        />
      </section>
    </div>
  );
}
