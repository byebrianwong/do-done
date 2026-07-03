"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getClientUserPrefsApi } from "@/lib/supabase/user-prefs-client";

interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
}

interface CalendarSectionProps {
  isConnected: boolean;
  /** user_preferences.show_calendar_events — show events inside DoDone views. */
  showEvents: boolean;
  syncedAt: string | null;
  status: "connected" | "disconnected" | "error" | null;
  errorMessage: string | null;
}

export function CalendarSection({
  isConnected,
  showEvents,
  syncedAt,
  status,
  errorMessage,
}: CalendarSectionProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [selectedCal, setSelectedCal] = useState("primary");
  const [savingCal, setSavingCal] = useState(false);

  const [showEventsLocal, setShowEventsLocal] = useState(showEvents);
  const [savingShowEvents, setSavingShowEvents] = useState(false);

  async function handleToggleShowEvents(next: boolean) {
    setShowEventsLocal(next);
    setSavingShowEvents(true);
    try {
      const prefs = await getClientUserPrefsApi();
      const { error } = await prefs.updateShowCalendarEvents(next);
      if (error) {
        setShowEventsLocal(!next);
        setSyncResult(`Error saving preference: ${error.message}`);
      }
    } catch (e) {
      setShowEventsLocal(!next);
      setSyncResult(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingShowEvents(false);
      startTransition(() => router.refresh());
    }
  }

  // Load the user's Google calendars once connected, so they can pick which one
  // to sync to.
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/calendar/list");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setCalendars(data.calendars ?? []);
        setSelectedCal(data.selected ?? "primary");
      } catch {
        // non-fatal — the picker just won't render
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/calendar/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSyncResult(`Error: ${data.error ?? "unknown"}`);
      } else {
        setSyncResult(
          `Pushed ${data.pushed}, pulled ${data.pulled}${data.errors?.length ? ` · ${data.errors.length} errors` : ""}`
        );
      }
    } catch (e) {
      setSyncResult(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
      startTransition(() => router.refresh());
    }
  }

  async function handleSelectCalendar(id: string) {
    const cal = calendars.find((c) => c.id === id);
    setSelectedCal(id);
    setSavingCal(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/calendar/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendar_id: id,
          calendar_summary: cal?.summary ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSyncResult(`Error switching calendar: ${data.error ?? "unknown"}`);
      } else {
        setSyncResult("Calendar switched — re-syncing your tasks to it.");
      }
    } catch (e) {
      setSyncResult(e instanceof Error ? e.message : "Switch failed");
    } finally {
      setSavingCal(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
            Google Calendar
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Two-way sync: scheduled tasks appear on your calendar (all-day when no
            time is set, otherwise a timeblock), and edits in Google Calendar flow
            back automatically. &ldquo;Sync now&rdquo; forces an immediate
            reconcile.
          </p>
          {isConnected && syncedAt && (
            <p className="mt-2 text-xs text-neutral-400">
              Last synced: {new Date(syncedAt).toLocaleString()}
            </p>
          )}
        </div>

        {isConnected ? (
          <div className="flex shrink-0 gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {syncing ? "Syncing..." : "Sync now"}
            </button>
            <form action="/api/calendar/disconnect" method="post">
              <button
                type="submit"
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
              >
                Disconnect
              </button>
            </form>
          </div>
        ) : (
          <a
            href="/api/calendar/connect"
            className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-600"
          >
            Connect
          </a>
        )}
      </div>

      {isConnected && calendars.length > 0 && (
        <div className="mt-4">
          <label
            htmlFor="calendar-select"
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            Sync to calendar
          </label>
          <select
            id="calendar-select"
            value={selectedCal}
            onChange={(e) => handleSelectCalendar(e.target.value)}
            disabled={savingCal}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? " (primary)" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-neutral-400">
            Switching re-syncs your tasks to the chosen calendar. Events already
            on the previous calendar aren&rsquo;t removed automatically.
          </p>
        </div>
      )}

      {isConnected && (
        <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={showEventsLocal}
              disabled={savingShowEvents}
              onChange={(e) => handleToggleShowEvents(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-500"
            />
            <span>
              <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Show calendar events in DoDone
              </span>
              <span className="mt-0.5 block text-[11px] text-neutral-400">
                Display events from your visible Google calendars alongside
                tasks in Today, Upcoming, and Calendar — so you can see
                everything happening in your day.
              </span>
            </span>
          </label>
        </div>
      )}

      {status === "connected" && (
        <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-950/50 dark:text-green-400">
          ✓ Connected to Google Calendar
        </div>
      )}
      {status === "disconnected" && (
        <div className="mt-4 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          Disconnected
        </div>
      )}
      {status === "error" && errorMessage && (
        <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-400">
          {errorMessage}
        </div>
      )}
      {syncResult && (
        <div className="mt-4 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          {syncResult}
        </div>
      )}
    </div>
  );
}
