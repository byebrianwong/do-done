// ── Status ↔ schedule auto-sync ─────────────────────────
//
// Two halves of one idea: a task's status and the day it's scheduled for are
// saying the same thing twice, and keeping them agreeing by hand is chores.
// With this on, the app keeps them in step in both directions:
//
//   promote  — a task scheduled on or before the horizon is moved *up* to the
//              chosen status ("anything within 3 days is Next"). Never moves a
//              task backwards, so In progress / Done / Cancelled are untouched.
//   backfill — putting a task *at* the chosen status (or past it) gives it a
//              scheduled date of the horizon, when it had none or had one
//              further out.
//
// **Promote fires on a change; it is not an invariant the app re-enforces.**
// It runs when a task's scheduled date is written inside the horizon, and when
// a task's day comes near because time passed. It does *not* run on a write
// that leaves the date alone. So moving a task Next → Not started by hand
// sticks, and stays stuck until you next touch its date.
//
// That distinction is the whole point. Enforcing it as an invariant meant a
// demotion snapped back instantly and there was no way to say "yes, I know
// it's tomorrow, leave it where I put it" — the app simply refused the edit,
// with nothing on screen saying why. A rule that fires on a change is a rule
// the user can work with; one that holds a field pinned is a rule they can
// only fight.
//
// The horizon is a single setting shared by both halves, so they can't
// disagree: promote pulls in exactly the window backfill schedules into.
//
// Off by default. Both halves toggle independently — the promote half rewrites
// statuses across the whole list as days pass, which is a much bigger claim on
// a user's list than the backfill half's one-task-at-a-time reaction.

import { STATUS_CONFIG, STATUS_ORDER, TERMINAL_STATUSES } from "./constants.js";
import type { StatusSyncSettings, TaskStatus } from "./schemas.js";
import { StatusSyncSettingsSchema, SyncTargetStatus } from "./schemas.js";
import type { QuickScheduleKey } from "./utils.js";
import { resolveQuickSchedule } from "./utils.js";

// ── Settings ───────────────────────────────────────────
//
// The schemas themselves live in schemas.ts (this module imports it, and
// UserPreferences carries the same fields). Everything below is the behaviour.

/** Ordered sync targets, for the settings picker. */
export const SYNC_TARGET_STATUSES = SyncTargetStatus.options;

export const DEFAULT_STATUS_SYNC: StatusSyncSettings =
  StatusSyncSettingsSchema.parse({});

/**
 * Read sync settings off anything shaped like a preferences row — a real
 * `UserPreferences`, a partial from `select("*")` on a database that hasn't run
 * the migration yet, or null. Unknown/missing fields fall back to the defaults,
 * which have both halves off, so a pre-migration read can never start
 * rewriting statuses.
 */
export function parseStatusSyncSettings(row: unknown): StatusSyncSettings {
  const result = StatusSyncSettingsSchema.safeParse(row ?? {});
  return result.success ? result.data : DEFAULT_STATUS_SYNC;
}

/** True when either half is on — i.e. there is any work for the rules to do. */
export function isStatusSyncActive(settings: StatusSyncSettings): boolean {
  return settings.status_sync_promote || settings.status_sync_backfill;
}

// ── Horizon ────────────────────────────────────────────

/**
 * The last day that counts as "near" — a local YYYY-MM-DD. Both halves read
 * it: promote treats `scheduled_date <= horizon` as near, backfill writes this
 * exact date.
 *
 * `todayISO` is passed in rather than read from the clock so the caller can
 * resolve "today" in the *user's* timezone (`todayISOInZone`) — server code
 * runs in UTC and would otherwise be a day out either side of midnight.
 */
export function resolveStatusSyncHorizon(
  settings: StatusSyncSettings,
  todayISO: string
): string {
  const from = new Date(todayISO + "T00:00:00");
  if (Number.isNaN(from.getTime())) return todayISO;
  if (settings.status_sync_horizon_kind === "quick") {
    return resolveQuickSchedule(
      settings.status_sync_horizon_key as QuickScheduleKey,
      from
    );
  }
  from.setDate(from.getDate() + settings.status_sync_horizon_days);
  const y = from.getFullYear();
  const m = String(from.getMonth() + 1).padStart(2, "0");
  const d = String(from.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The band of scheduled dates the periodic sweep should promote — the days
 * that have *newly* come inside the horizon since it last ran.
 *
 * `after` is exclusive, `through` inclusive, so the sweep's filter reads
 * `scheduled_date > after and scheduled_date <= through`. A null `after` means
 * no lower bound: the first sweep for a user (or the first after they turn
 * promote on) applies the rule to their whole list, which is what enabling a
 * setting should do.
 *
 * Returns null when nothing new has crossed in and the sweep should not write
 * at all.
 *
 * **The lower bound is what lets a manual demotion survive.** Without it the
 * sweep re-promotes every near task on every foreground, so a task moved back
 * to Not started is back at Next within seconds — the exact behaviour the
 * write-time rule above stopped doing. With it, the sweep only ever touches
 * days it has not already accounted for.
 *
 * `sweptThrough` ahead of `horizonISO` is not an error and is deliberately
 * *not* wound back: it means those days were already handled (the user
 * narrowed the horizon), and lowering the mark would re-promote them as the
 * days came round again.
 */
export function sweepPromoteRange(
  horizonISO: string,
  sweptThrough: string | null
): { after: string | null; through: string } | null {
  if (sweptThrough === null) return { after: null, through: horizonISO };
  if (sweptThrough >= horizonISO) return null;
  return { after: sweptThrough, through: horizonISO };
}

/** Human-readable horizon, for settings copy: "3 days", "this weekend". */
export function describeStatusSyncHorizon(settings: StatusSyncSettings): string {
  if (settings.status_sync_horizon_kind === "quick") {
    const labels: Record<string, string> = {
      today: "today",
      tomorrow: "tomorrow",
      this_week: "this week",
      this_weekend: "this weekend",
      next_week: "next week",
    };
    return labels[settings.status_sync_horizon_key] ?? settings.status_sync_horizon_key;
  }
  const n = settings.status_sync_horizon_days;
  if (n === 0) return "today";
  if (n === 1) return "1 day";
  return `${n} days`;
}

// ── Lifecycle ordering ─────────────────────────────────

/**
 * Position in the lifecycle (`STATUS_ORDER`). Higher = further along. This is
 * what "not already a further status" means: promote only ever raises the rank,
 * so a task the user has already started, finished or cancelled is left alone.
 */
export function statusRank(status: TaskStatus): number {
  const i = STATUS_ORDER.indexOf(status);
  // An unmigrated/unknown value sorts to the bottom rather than the top: better
  // to promote something odd than to silently exempt it.
  return i === -1 ? -1 : i;
}

/**
 * The statuses promote is allowed to move *from*, given a target — everything
 * strictly below it in the lifecycle. Exported because the bulk sweep turns it
 * straight into a SQL `status in (...)` filter.
 */
export function statusesBelow(target: TaskStatus): TaskStatus[] {
  const rank = statusRank(target);
  return STATUS_ORDER.filter((s) => statusRank(s) < rank);
}

function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// ── The two rules ──────────────────────────────────────

/** The subset of a task the rules actually look at. */
export interface StatusSyncTask {
  status: TaskStatus;
  scheduled_date: string | null;
}

/**
 * Date → status. Returns the status the task should be moved to, or null to
 * leave it alone.
 *
 * Fires when the task has a scheduled date on or before the horizon (an
 * *overdue* task is inside the horizon too — it's as near as near gets) and
 * sits below the target in the lifecycle.
 */
export function promotedStatus(
  task: StatusSyncTask,
  settings: StatusSyncSettings,
  horizonISO: string
): TaskStatus | null {
  if (!settings.status_sync_promote) return null;
  if (!task.scheduled_date) return null;
  if (task.scheduled_date > horizonISO) return null;
  const target = settings.status_sync_status;
  if (statusRank(task.status) >= statusRank(target)) return null;
  return target;
}

/**
 * Status → date. Returns the scheduled date the task should be given, or null
 * to leave it alone.
 *
 * Fires when the task is at the target status *or past it* — starting
 * something is at least as strong a commitment as queuing it, so In progress
 * earns a date too — and is either undated or scheduled beyond the horizon.
 * Terminal statuses are exempt: finishing a task is not a plan to do it.
 */
export function backfilledScheduledDate(
  task: StatusSyncTask,
  settings: StatusSyncSettings,
  horizonISO: string
): string | null {
  if (!settings.status_sync_backfill) return null;
  if (isTerminal(task.status)) return null;
  if (statusRank(task.status) < statusRank(settings.status_sync_status)) {
    return null;
  }
  if (task.scheduled_date && task.scheduled_date <= horizonISO) return null;
  return horizonISO;
}

// ── Write-time application ─────────────────────────────

/**
 * Extra columns to fold into a task write so the row lands already in sync.
 * Empty when nothing applies, which is the common case.
 *
 * `prior` is the row as it stands (null when creating); `patch` is what the
 * caller is about to write. The rules run against the *effective* task — the
 * patch layered over the prior row — so a write that touches only one of the
 * two fields still sees the other.
 *
 * Three precedence choices:
 *
 * - An explicit `scheduled_date` in the patch always wins over backfill. If
 *   you set the status and the date in the same save, the date you picked is
 *   the date you get.
 * - **Promote only fires on a write that moves the date** (or creates the
 *   task, or has backfill supply a date). A write that leaves the date alone
 *   leaves the status alone, so dragging a task scheduled for tomorrow back to
 *   Not started keeps it there.
 * - **But a date change re-applies the rule regardless of status**, including
 *   in the same write. Set a Not started task to tomorrow and it goes to Next:
 *   the date is the newer instruction, and re-dating a task is exactly the
 *   moment its place in the queue is worth reconsidering. Demote it again
 *   afterwards and it stays demoted, until the next time the date moves.
 */
export function statusSyncPatch(args: {
  prior: StatusSyncTask | null;
  patch: { status?: TaskStatus; scheduled_date?: string | null };
  settings: StatusSyncSettings;
  horizonISO: string;
}): { status?: TaskStatus; scheduled_date?: string } {
  const { prior, patch, settings, horizonISO } = args;
  if (!isStatusSyncActive(settings)) return {};

  const status = patch.status ?? prior?.status ?? "inbox";
  const scheduled_date =
    patch.scheduled_date !== undefined
      ? patch.scheduled_date
      : (prior?.scheduled_date ?? null);

  const out: { status?: TaskStatus; scheduled_date?: string } = {};

  // Backfill first: it can only add a date, and only when the caller didn't
  // name one. The date it adds is the horizon itself, so the promote pass below
  // then sees a task that is by construction "near".
  if (patch.scheduled_date === undefined) {
    const date = backfilledScheduledDate(
      { status, scheduled_date },
      settings,
      horizonISO
    );
    if (date !== null) out.scheduled_date = date;
  }

  // Promote is a reaction to the date moving, so establish whether it did.
  // Creating counts (there is no prior date to have moved from), and so does
  // backfill having just supplied one above.
  const dateMoved =
    prior === null ||
    out.scheduled_date !== undefined ||
    (patch.scheduled_date !== undefined &&
      patch.scheduled_date !== prior.scheduled_date);
  if (!dateMoved) return out;

  const effectiveDate = out.scheduled_date ?? scheduled_date;
  const next = promotedStatus(
    { status, scheduled_date: effectiveDate },
    settings,
    horizonISO
  );
  if (next !== null && next !== status) out.status = next;

  return out;
}

// ── Telling the user ───────────────────────────────────
//
// An automatic move the user did not ask for has to announce itself, or it is
// indistinguishable from the app ignoring the edit. That was the whole failure
// of the invariant version of this rule: it was doing exactly what the setting
// said, and it read as a bug, because the only evidence was a field springing
// back with nothing to explain it.
//
// The copy lives here so the phone and the laptop cannot word it differently,
// and so it can be tested in node — which on mobile is the only place anything
// can be.

/** What the rule did to one task on one write. */
export interface StatusSyncNotice {
  status?: TaskStatus;
  scheduled_date?: string;
}

/**
 * One sentence for a write the rule adjusted, or null when it adjusted
 * nothing. Names the setting ("scheduled within 3 days") rather than just the
 * outcome, because a user who does not remember turning this on needs to know
 * a rule exists before they can go and change it.
 */
export function describeStatusSyncNotice(
  notice: StatusSyncNotice,
  settings: StatusSyncSettings
): string | null {
  const horizon = describeStatusSyncHorizon(settings);
  if (notice.status) {
    const label = STATUS_CONFIG[notice.status]?.label ?? notice.status;
    // "within today" is not English; the zero-day horizon reads as "due today".
    const when = horizon === "today" ? "scheduled today" : `within ${horizon}`;
    return `Moved to ${label} — ${when}`;
  }
  if (notice.scheduled_date) {
    const label = STATUS_CONFIG[settings.status_sync_status]?.label ??
      settings.status_sync_status;
    return `Scheduled for ${horizon} — ${label} tasks get a date`;
  }
  return null;
}

/**
 * The sweep's line: N tasks moved because their day came near. Singular names
 * the task, because one is the common case and a title is far more use than a
 * count; plural does not, because a list of titles in a toast is not readable
 * in the time a toast is up.
 */
export function describeStatusSyncSweep(
  moved: { title: string }[],
  settings: StatusSyncSettings
): string | null {
  if (moved.length === 0) return null;
  const label =
    STATUS_CONFIG[settings.status_sync_status]?.label ??
    settings.status_sync_status;
  if (moved.length === 1) {
    return `"${moved[0]!.title}" moved to ${label} — it's coming up`;
  }
  return `${moved.length} tasks moved to ${label} — they're coming up`;
}
