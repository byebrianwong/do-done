"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_DISPLAY_CALENDARS,
  isCalendarVisible,
  toHiddenIds,
  type CalendarOption,
} from "@do-done/shared";
import { getClientUserPrefsApi } from "@/lib/supabase/user-prefs-client";

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

  // Which calendars feed the in-app views. `null` until /list answers — the
  // initial ticks are derived there, from the stored exclusion set or (first
  // visit) from Google's own visible flags.
  const [visibleIds, setVisibleIds] = useState<Set<string> | null>(null);
  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  // Toggles save one at a time. Each write replaces the whole array, so two in
  // flight at once could land out of order and resurrect a stale selection.
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const writableCalendars = useMemo(
    () => calendars.filter((c) => c.canWrite),
    [calendars]
  );
  const visibleCount = visibleIds?.size ?? 0;
  const atLimit = visibleCount >= MAX_DISPLAY_CALENDARS;
  // Only reachable from the first-visit defaults: Google can have more than
  // MAX ticked, and we'd rather show the user which ones are being dropped
  // than pretend the cap isn't there.
  const overLimit = Math.max(0, visibleCount - MAX_DISPLAY_CALENDARS);
  const droppedNames = useMemo(() => {
    if (!visibleIds || overLimit === 0) return [];
    return calendars
      .filter((c) => visibleIds.has(c.id))
      .slice(MAX_DISPLAY_CALENDARS)
      .map((c) => c.summary);
  }, [calendars, visibleIds, overLimit]);

  function handleToggleCalendar(id: string, next: boolean) {
    if (!visibleIds) return;
    const updated = new Set(visibleIds);
    if (next) {
      if (updated.size >= MAX_DISPLAY_CALENDARS) return;
      updated.add(id);
    } else {
      updated.delete(id);
    }
    setVisibleIds(updated);
    setCalendarsError(null);

    const hidden = toHiddenIds(
      calendars.map((c) => c.id),
      updated
    );
    saveChain.current = saveChain.current
      .then(async () => {
        const prefs = await getClientUserPrefsApi();
        const { error } = await prefs.updateHiddenCalendars(hidden);
        if (error) throw error;
      })
      .catch((e: unknown) => {
        // Don't roll the checkbox back: later toggles may already have queued
        // behind this one, and snapping a box the user just clicked is worse
        // than telling them the save didn't stick.
        setCalendarsError(
          e instanceof Error ? e.message : "Couldn't save calendar selection"
        );
      });
  }

  // No router.refresh() here: the checkbox is driven by local state (with
  // rollback on failure), and the pref only affects OTHER pages' server
  // renders — they refetch on navigation anyway.
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
    }
  }

  // Load the user's Google calendars once connected: which one to sync to, and
  // which ones to display.
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/calendar/list");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const cals: CalendarOption[] = data.calendars ?? [];
        setCalendars(cals);
        setSelectedCal(data.selected ?? "primary");
        // `hidden: null` = never configured, so the boxes start where the
        // views already are — on Google's visible flags — and the user edits
        // from there rather than from a blank slate.
        const hidden: string[] | null = Array.isArray(data.hidden)
          ? data.hidden
          : null;
        setVisibleIds(
          new Set(
            cals.filter((c) => isCalendarVisible(c, hidden)).map((c) => c.id)
          )
        );
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

      {isConnected && writableCalendars.length > 0 && (
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
            {writableCalendars.map((c) => (
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
                Display events from the calendars you choose below alongside
                tasks in Today, Upcoming, and Calendar — so you can see
                everything happening in your day.
              </span>
            </span>
          </label>

          {showEventsLocal && visibleIds && calendars.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Calendars to show
                </span>
                <span className="text-[11px] tabular-nums text-neutral-400">
                  {visibleCount} of {MAX_DISPLAY_CALENDARS}
                </span>
              </div>

              {/* dd-scroll draws the scrollbar; color-scheme stays because the
                  rows hold native checkboxes, which the UA renders light
                  without it. */}
              <div className="mt-1.5 max-h-64 dd-scroll overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-800 dark:[color-scheme:dark]">
                {calendars.map((c) => {
                  const checked = visibleIds.has(c.id);
                  // At the limit, the only useful click is unticking — leave
                  // the rest inert rather than failing the click silently.
                  const locked = !checked && atLimit;
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2.5 border-b border-neutral-100 px-3 py-2 last:border-b-0 dark:border-neutral-800/70 ${
                        locked
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        onChange={(e) =>
                          handleToggleCalendar(c.id, e.target.checked)
                        }
                        className="h-4 w-4 shrink-0 accent-indigo-500"
                      />
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10 dark:border-white/20"
                        style={{ backgroundColor: c.color ?? "#9ca3af" }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-700 dark:text-neutral-300">
                        {c.summary}
                      </span>
                      {c.primary && (
                        <span className="shrink-0 text-[10px] text-neutral-400">
                          primary
                        </span>
                      )}
                      {!c.canWrite && !c.primary && (
                        <span className="shrink-0 text-[10px] text-neutral-400">
                          read-only
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {overLimit > 0 ? (
                <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-500">
                  {overLimit} over the limit —{" "}
                  {droppedNames.slice(0, 3).join(", ")}
                  {droppedNames.length > 3
                    ? ` and ${droppedNames.length - 3} more`
                    : ""}{" "}
                  {overLimit === 1 ? "isn't" : "aren't"} being loaded. Untick{" "}
                  {overLimit} to choose which.
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-neutral-400">
                  New calendars show up here automatically. A calendar you
                  create in Google appears in DoDone without being switched on
                  {atLimit ? " — untick one first to make room." : "."}
                </p>
              )}
              {calendarsError && (
                <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
                  {calendarsError}
                </p>
              )}
            </div>
          )}
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
