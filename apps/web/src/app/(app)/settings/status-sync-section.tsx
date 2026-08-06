"use client";

import { useState } from "react";
import {
  DEFAULT_STATUS_SYNC,
  STATUS_CONFIG,
  SYNC_TARGET_STATUSES,
  describeStatusSyncHorizon,
  type StatusSyncSettings,
  type UpdateStatusSyncInput,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { getClientUserPrefsApi } from "@/lib/supabase/user-prefs-client";

/**
 * The horizon picker flattens the two stored representations — a day count and
 * a weekday anchor — into one list, because "in 3 days" and "this weekend" are
 * the same kind of answer to the user even though they're different arithmetic.
 * The `kind` column is what the option writes back.
 *
 * Each option carries two phrasings, because the two halves of the rule mean
 * different things by the same horizon. Promote asks whether a date falls in a
 * *window*; backfill writes one specific *day*. "Within the next 3 days" and
 * "for Friday" are both right, and swapping them reads as nonsense.
 */
const HORIZON_OPTIONS: {
  value: string;
  /** Names the span — the picker label, and the promote sentence. */
  window: string;
  /** Names the single day backfill would write. */
  day: string;
  patch: Pick<
    StatusSyncSettings,
    "status_sync_horizon_kind" | "status_sync_horizon_days" | "status_sync_horizon_key"
  >;
}[] = [
  ...[
    { days: 0, window: "today", day: "today" },
    { days: 1, window: "today or tomorrow", day: "tomorrow" },
    { days: 2, window: "the next 2 days", day: "2 days from now" },
    { days: 3, window: "the next 3 days", day: "3 days from now" },
    { days: 5, window: "the next 5 days", day: "5 days from now" },
    { days: 7, window: "the next 7 days", day: "a week from now" },
    { days: 14, window: "the next 14 days", day: "two weeks from now" },
  ].map(({ days, window, day }) => ({
    value: `days:${days}`,
    window,
    day,
    patch: {
      status_sync_horizon_kind: "days" as const,
      status_sync_horizon_days: days,
      status_sync_horizon_key: DEFAULT_STATUS_SYNC.status_sync_horizon_key,
    },
  })),
  {
    value: "quick:this_week",
    window: "this week",
    day: "Friday",
    patch: {
      status_sync_horizon_kind: "quick" as const,
      status_sync_horizon_days: DEFAULT_STATUS_SYNC.status_sync_horizon_days,
      status_sync_horizon_key: "this_week" as const,
    },
  },
  {
    value: "quick:this_weekend",
    window: "this weekend",
    day: "Sunday",
    patch: {
      status_sync_horizon_kind: "quick" as const,
      status_sync_horizon_days: DEFAULT_STATUS_SYNC.status_sync_horizon_days,
      status_sync_horizon_key: "this_weekend" as const,
    },
  },
];

function horizonValue(s: StatusSyncSettings): string {
  return s.status_sync_horizon_kind === "quick"
    ? `quick:${s.status_sync_horizon_key}`
    : `days:${s.status_sync_horizon_days}`;
}

function phrases(s: StatusSyncSettings): { window: string; day: string } {
  const opt = HORIZON_OPTIONS.find((o) => o.value === horizonValue(s));
  // A horizon saved from another surface (or a future option) still needs to
  // render something true.
  const fallback = describeStatusSyncHorizon(s);
  return { window: opt?.window ?? fallback, day: opt?.day ?? fallback };
}

export function StatusSyncSection({ settings }: { settings: StatusSyncSettings }) {
  const [local, setLocal] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: UpdateStatusSyncInput) {
    const before = local;
    setLocal({ ...local, ...patch });
    setSaving(true);
    setError(null);
    try {
      const prefs = await getClientUserPrefsApi();
      const { error } = await prefs.updateStatusSync(patch);
      if (error) throw error;
      // Apply the new rule to the existing list right away. Without this the
      // switch reads as broken: nothing visibly happens until a task is
      // touched or the page is reloaded.
      const next = { ...before, ...patch };
      if (next.status_sync_promote) {
        const tasks = await getClientTasksApi();
        await tasks.syncScheduledToStatus();
      }
    } catch (e) {
      setLocal(before);
      setError(e instanceof Error ? e.message : "Couldn't save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = STATUS_CONFIG[local.status_sync_status]?.label ?? "Next";
  const { window: windowPhrase, day: dayPhrase } = phrases(local);
  // The pickers only mean anything once a rule is switched on.
  const idle = !local.status_sync_promote && !local.status_sync_backfill;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
        Status and schedule
      </h3>
      <p className="mt-1 text-xs text-neutral-500">
        A task&rsquo;s status and the day it&rsquo;s scheduled for are usually
        saying the same thing. Let DoDone keep them in step.
      </p>

      <div className="mt-4 space-y-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={local.status_sync_promote}
            disabled={saving}
            onChange={(e) => save({ status_sync_promote: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500"
          />
          <span className="text-sm text-neutral-700 dark:text-neutral-300">
            Move tasks scheduled within {windowPhrase} to{" "}
            <span className="font-medium">{statusLabel}</span>
            <span className="mt-0.5 block text-xs text-neutral-500">
              Anything already at {statusLabel} or further along is left where
              it is. Overdue tasks count as near.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={local.status_sync_backfill}
            disabled={saving}
            onChange={(e) => save({ status_sync_backfill: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-500"
          />
          <span className="text-sm text-neutral-700 dark:text-neutral-300">
            Schedule tasks you move to{" "}
            <span className="font-medium">{statusLabel}</span> for {dayPhrase}
            <span className="mt-0.5 block text-xs text-neutral-500">
              Only when the task has no scheduled date, or one further out. A
              date you pick yourself always wins.
            </span>
          </span>
        </label>
      </div>

      <div
        className={`mt-4 grid gap-3 border-t border-neutral-200 pt-4 sm:grid-cols-2 dark:border-neutral-800 ${
          idle ? "opacity-50" : ""
        }`}
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            Status
          </span>
          <select
            value={local.status_sync_status}
            disabled={saving || idle}
            onChange={(e) =>
              save({
                status_sync_status: e.target
                  .value as StatusSyncSettings["status_sync_status"],
              })
            }
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {SYNC_TARGET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_CONFIG[s]?.label ?? s}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-500">
            Window
          </span>
          <select
            value={horizonValue(local)}
            disabled={saving || idle}
            onChange={(e) => {
              const opt = HORIZON_OPTIONS.find((o) => o.value === e.target.value);
              if (opt) save(opt.patch);
            }}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {HORIZON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.window}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
