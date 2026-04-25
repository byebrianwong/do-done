"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface CalendarSectionProps {
  isConnected: boolean;
  syncedAt: string | null;
  status: "connected" | "disconnected" | "error" | null;
  errorMessage: string | null;
}

export function CalendarSection({
  isConnected,
  syncedAt,
  status,
  errorMessage,
}: CalendarSectionProps) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [, startTransition] = useTransition();

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

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
            Google Calendar
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            Sync tasks with start times and durations as calendar timeblocks.
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
