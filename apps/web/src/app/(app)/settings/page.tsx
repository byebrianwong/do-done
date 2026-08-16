import Link from "next/link";
import { parseStatusSyncSettings } from "@do-done/shared";
import { createServerSupabase } from "@/lib/supabase/server";
import { CalendarSection } from "./calendar-section";
import { TimezoneSection } from "./timezone-section";
import { StatusSyncSection } from "./status-sync-section";

/**
 * A door to the Places view, which lives in the sidebar once you have one.
 *
 * The sidebar row is hidden until your first place exists, for the reason the
 * Lists section is — so this is what you find before then, and it is where
 * someone coming from the phone will look, since mobile keeps the places
 * screen under Settings.
 */
/**
 * A door to Lists, which lives in the sidebar once you have one.
 *
 * The sidebar section is hidden until your first list exists — a permanent
 * heading for an unused feature is exactly the clutter shopping lists are meant
 * to avoid. But hiding the *only* link to `/lists` also hid the only place a
 * first list can be made, so the feature shipped unreachable on every real
 * account: the sidebar needed a list to show the link, and the link was needed
 * to make a list. This is the way in before then, same as `PlacesSection`
 * above it.
 */
function ListsSection() {
  return (
    <Link
      href="/lists"
      className="block rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Shopping lists
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Groceries, Amazon, the hardware store. Things to buy are kept out of
            Today, Inbox and All tasks — they live on their own lists, grouped
            by aisle. Lists appear in the sidebar once you have one.
          </p>
        </div>
        <span aria-hidden className="shrink-0 text-neutral-400">
          →
        </span>
      </div>
    </Link>
  );
}

function PlacesSection() {
  return (
    <Link
      href="/places"
      className="block rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Saved places
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            Rename a place, change how close you have to get, or delete one.
            Reminders themselves are attached to a task, under Places in its
            editor — and they arrive on your phone.
          </p>
        </div>
        <span aria-hidden className="shrink-0 text-neutral-400">
          →
        </span>
      </div>
    </Link>
  );
}

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
          <ListsSection />
          <PlacesSection />
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
