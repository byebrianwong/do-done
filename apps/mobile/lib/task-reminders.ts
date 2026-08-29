import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildDayStartRoundup,
  buildTaskReminder,
  parseNotificationSettings,
  todayISOInZone,
  type NotificationSettings,
  type Task,
} from '@do-done/shared';
import { getProjectsApi, getTasksApi, getUserPrefsApi } from './supabase';
import {
  cancelNotifications,
  hasNotificationPermission,
  notificationsSupported,
  scheduleNotification,
} from './notifications';
import {
  planTaskReminders,
  reminderQueryRange,
  type ReminderOccurrence,
} from './task-reminder-plan';

/**
 * Arming the per-task reminders.
 *
 * `task-reminder-plan.ts` decides *when* each one fires and how many fit;
 * this decides what each one says and hands it to the OS. The shape is the
 * digest scheduler's, deliberately — same identifier bookkeeping, same
 * cancel-then-re-arm, same refusal to call
 * `cancelAllScheduledNotificationsAsync()` (see notifications.ts).
 *
 * ### What is different from the digests: *when* it re-arms
 *
 * A digest describes an aggregate, so being one task stale for a few hours is
 * harmless and re-arming on foreground is enough. A task reminder is about one
 * specific task, and the moment it most needs to exist is the moment it is
 * created: type "call the bank at 3pm" at 2:40 and background the phone, and a
 * foreground-only re-arm would never arm it at all.
 *
 * So this also hangs off `invalidateTasks()` in `task-queries.ts` — the one
 * seam every mobile write lands on — through the same debounced-sync shape the
 * widget refresh and the geofence sync already use there. Typing in the editor
 * invalidates on every keystroke, so the debounce is doing real work.
 */

const IDS_KEY = 'notify:task-reminders:ids';

async function readIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(IDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIds(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(IDS_KEY, JSON.stringify(ids));
  } catch {
    // Worst case we lose track of an armed reminder and the next re-arm
    // duplicates it. Never throw — this runs from an AppState listener.
  }
}

/** Cancel every task reminder we have armed, and forget them. */
export async function clearTaskReminders(): Promise<void> {
  const ids = await readIds();
  if (ids.length > 0) await cancelNotifications(ids);
  await writeIds([]);
}

async function loadSettings(): Promise<{
  settings: NotificationSettings;
  timeZone: string;
} | null> {
  try {
    const api = await getUserPrefsApi();
    const { data, error } = await api.get();
    if (error) return null;
    return {
      settings: parseNotificationSettings(data),
      // The account's timezone, never the device's. A 3pm task is 3pm where
      // the user lives, and the two disagree while travelling.
      timeZone: data?.timezone ?? 'America/New_York',
    };
  } catch {
    return null;
  }
}

/**
 * The open, dated tasks the plan needs.
 *
 * One query, unlike the digests' two: there is deliberately no overdue read
 * here. An overdue task's day has already come and its reminder has already
 * been and gone — announcing it again today would mean every slipped task
 * pinging forever. Overdue is the digest's job.
 */
async function loadTasks(startISO: string, endISO: string): Promise<Task[] | null> {
  try {
    const api = await getTasksApi();
    const { data, error } = await api.getDatedBetween(startISO, endISO);
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Project names by id, for the line under a reminder's title.
 *
 * Best-effort by design, exactly like the widget's project read: a failure
 * yields an empty map and the reminders still fire, just without naming the
 * project. Letting a cosmetic outage take down the reminder itself would be
 * the wrong trade.
 */
async function loadProjectNames(): Promise<Map<string, string>> {
  try {
    const api = await getProjectsApi();
    const { data, error } = await api.list();
    if (error) return new Map();
    return new Map(data.map((p) => [p.id, p.name]));
  } catch {
    return new Map();
  }
}

function contentFor(
  occurrence: ReminderOccurrence,
  tasks: Task[],
  settings: NotificationSettings,
  projectNames: Map<string, string>
) {
  if (occurrence.kind === 'task') {
    return buildTaskReminder(occurrence.task, {
      leadMinutes: settings.notify_task_reminder_lead_minutes,
      projectName: occurrence.task.project_id
        ? (projectNames.get(occurrence.task.project_id) ?? null)
        : null,
    });
  }
  return buildDayStartRoundup(tasks, occurrence.dateISO);
}

/**
 * A tapped reminder opens the thing it was about — the task itself, or Today
 * for a roundup. See `notification-routing.ts`.
 */
function payloadFor(occurrence: ReminderOccurrence): Record<string, unknown> {
  return occurrence.kind === 'task'
    ? { kind: 'task-reminder', taskId: occurrence.task.id }
    : { kind: 'day-start', dateISO: occurrence.dateISO };
}

export interface RearmRemindersResult {
  scheduled: number;
  /** Occurrences the cap left out. Surfaced rather than swallowed. */
  dropped: number;
  reason?:
    | 'unsupported'
    | 'not_permitted'
    | 'disabled'
    | 'settings_unavailable'
    | 'tasks_unavailable';
}

/**
 * Cancel what is armed and arm the plan again from current data.
 *
 * Safe to call often: one prefs read, one task read, one project read, then a
 * handful of schedule calls. Returns what it did so the settings screen can
 * say so out loud; the lifecycle callers ignore it.
 */
export async function rearmTaskReminders(): Promise<RearmRemindersResult> {
  if (!notificationsSupported()) {
    return { scheduled: 0, dropped: 0, reason: 'unsupported' };
  }

  const loaded = await loadSettings();
  if (!loaded) {
    // Leaves the existing schedule alone. A failed prefs read is usually a
    // dropped connection, and cancelling on that would silently disarm the
    // feature for anyone who opened the app on a bad train.
    return { scheduled: 0, dropped: 0, reason: 'settings_unavailable' };
  }

  const { settings, timeZone } = loaded;

  if (!settings.notify_task_reminders) {
    await clearTaskReminders();
    return { scheduled: 0, dropped: 0, reason: 'disabled' };
  }

  // After the enabled test, so switching reminders off still tears down the
  // schedule even once permission has been revoked in system settings.
  if (!(await hasNotificationPermission())) {
    return { scheduled: 0, dropped: 0, reason: 'not_permitted' };
  }

  const now = new Date();
  const range = reminderQueryRange(timeZone, now);
  const tasks = await loadTasks(range.startISO, range.endISO);
  if (!tasks) {
    // Same reasoning as the settings read: keep the existing schedule, which
    // is approximately right, rather than replacing it with nothing.
    return { scheduled: 0, dropped: 0, reason: 'tasks_unavailable' };
  }

  const plan = planTaskReminders(tasks, settings, { now, timeZone });
  const projectNames = plan.occurrences.some(
    (o) => o.kind === 'task' && o.task.project_id
  )
    ? await loadProjectNames()
    : new Map<string, string>();

  await clearTaskReminders();

  const ids: string[] = [];
  for (const occurrence of plan.occurrences) {
    const content = contentFor(occurrence, tasks, settings, projectNames);
    if (!content) continue;
    const id = await scheduleNotification({
      title: content.title,
      body: content.body,
      channel: 'task',
      at: occurrence.at,
      data: payloadFor(occurrence),
    });
    if (id) ids.push(id);
  }

  await writeIds(ids);

  if (plan.dropped > 0) {
    // Never a silent cap. The OS would have discarded an arbitrary tail with
    // no message at all; this at least names the number in a log.
    console.warn(
      `[task-reminders] armed ${ids.length}, ${plan.dropped} past the cap`
    );
  }

  return { scheduled: ids.length, dropped: plan.dropped };
}

/**
 * Post a reminder-shaped notification right now, so the settings screen can
 * prove the channel works.
 *
 * Uses today's roundup when there is one, because that is the notification the
 * user is most likely to be asking about; otherwise a worked example. Same
 * reasoning as `sendTestDigest`: the user pressed a button, so silence would
 * read as the feature being broken, which is the question the button exists to
 * answer.
 */
export async function sendTestTaskReminder(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const loaded = await loadSettings();
  const timeZone = loaded?.timeZone ?? 'America/New_York';
  const today = todayISOInZone(timeZone, new Date());

  const tasks = (await loadTasks(today, today)) ?? [];
  const content = buildDayStartRoundup(tasks, today) ?? {
    title: 'Nothing scheduled without a time today',
    body: 'This is what a reminder looks like. Real ones arrive when a task’s time comes round.',
  };

  const id = await scheduleNotification({
    ...content,
    channel: 'task',
    data: { kind: 'day-start', dateISO: today },
  });
  return id !== null;
}

// ── Lifecycle ──────────────────────────────────────────

let running = false;
let queued = false;

/**
 * Re-arm, never overlapping with itself and never throwing at the caller.
 *
 * A request that arrives mid-run sets `queued` rather than being dropped: the
 * write that triggered it is precisely the one whose reminder is missing from
 * the plan currently being armed, so dropping it would leave the newest task
 * unarmed until the next foreground.
 */
export async function safeRearmTaskReminders(): Promise<void> {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    await rearmTaskReminders();
  } catch {
    // Housekeeping the user didn't ask for by name — never surface it.
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void safeRearmTaskReminders();
    }
  }
}

const SYNC_DEBOUNCE_MS = 5_000;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalescing re-arm, for `invalidateTasks()` — which fires on every write,
 * including every keystroke in the task editor. Bursts collapse into one
 * re-arm a few seconds after the user stops.
 */
export function scheduleTaskReminderSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void safeRearmTaskReminders();
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Re-arm on launch and on every return to the foreground.
 *
 * The same trigger the digests and the status-sync sweep use: it is the only
 * moment the app reliably notices that a day went past while it was
 * backgrounded, and the point at which what is armed is most likely to have
 * gone stale against edits made on another device.
 *
 * Returns an unsubscribe function.
 */
export function startTaskReminderScheduling(): () => void {
  void safeRearmTaskReminders();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void safeRearmTaskReminders();
  });
  return () => sub.remove();
}
