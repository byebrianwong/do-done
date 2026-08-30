import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  buildDailyDigest,
  buildWeeklyDigest,
  isDigestEnabled,
  parseNotificationSettings,
  type NotificationSettings,
  type Task,
} from '@do-done/shared';
import { getTasksApi, getUserPrefsApi } from './supabase';
import {
  cancelNotifications,
  hasNotificationPermission,
  notificationsSupported,
  scheduleNotification,
} from './notifications';
import { planDigests, planQueryRange, type DigestOccurrence } from './digest-plan';

/**
 * Arming the daily and weekly digests.
 *
 * `digest-plan.ts` decides *when* and *over what window*; this decides what
 * each one says and hands it to the OS. See that file for why the plan is
 * re-armed rather than left to a repeating trigger.
 *
 * ### The identifiers are the whole cancellation mechanism
 *
 * Re-arming means taking back the occurrences already scheduled, and the only
 * handle for that is the identifier `scheduleNotificationAsync` returns. They
 * are kept in AsyncStorage, not module state, because the plan outlives the JS
 * context that created it — an app killed overnight comes back with a fresh
 * context and eight of its own notifications already queued.
 *
 * `cancelAllScheduledNotificationsAsync()` would do the same job in one call
 * and must not be used. The geofence dwell filter works by scheduling a
 * reminder a couple of minutes out and cancelling it if you leave again, so at
 * any moment the queue may contain a notification that *is* the location
 * feature working. Clearing everything would eat it, and the symptom — a
 * location reminder that fires only when you don't happen to open the app in
 * the two minutes after arriving — is one nobody would ever reproduce
 * deliberately.
 */

const IDS_KEY = 'notify:digest:ids';

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
    // Worst case we lose track of a scheduled digest and the next re-arm
    // duplicates it. Never throw — this runs from an AppState listener.
  }
}

/** Cancel every digest we have armed, and forget them. */
export async function clearScheduledDigests(): Promise<void> {
  const ids = await readIds();
  if (ids.length > 0) await cancelNotifications(ids);
  await writeIds([]);
}

/** The user's digest settings and timezone, or null if unreadable. */
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
      // The account's timezone, not the device's. A digest is a wall-clock
      // event in the user's life, and the two disagree while travelling.
      timeZone: data?.timezone ?? 'America/New_York',
    };
  } catch {
    return null;
  }
}

/**
 * The open tasks the whole plan needs, in one read.
 *
 * Two queries, not one: `getDatedBetween` covers the windows themselves, and
 * `getOverdue` covers work that has already slipped — which is the single most
 * useful thing a digest can tell someone and is, by definition, outside every
 * forward-looking window.
 */
async function loadTasks(
  startISO: string,
  endISO: string
): Promise<Task[] | null> {
  try {
    const api = await getTasksApi();
    const [dated, overdue] = await Promise.all([
      api.getDatedBetween(startISO, endISO),
      api.getOverdue(startISO),
    ]);
    if (dated.error || overdue.error) return null;
    // A task can be in both — overdue by its scheduled date and inside the
    // window by its deadline. Both builders count rows, so it has to appear
    // once.
    const byId = new Map<string, Task>();
    for (const t of [...dated.data, ...overdue.data]) byId.set(t.id, t);
    return [...byId.values()];
  } catch {
    return null;
  }
}

function contentFor(occurrence: DigestOccurrence, tasks: Task[]) {
  return occurrence.kind === 'daily'
    ? buildDailyDigest(tasks, occurrence.startISO)
    : buildWeeklyDigest(tasks, occurrence.startISO, occurrence.endISO);
}

export interface RearmResult {
  scheduled: number;
  /** Occurrences skipped because the window had nothing in it. */
  empty: number;
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
 * Safe to call often and from anywhere — it is one prefs read, one pair of task
 * reads, and a handful of schedule calls. Returns what it did so the settings
 * screen can say so out loud; every caller on a lifecycle event ignores it.
 */
export async function rearmDigests(): Promise<RearmResult> {
  if (!notificationsSupported()) {
    return { scheduled: 0, empty: 0, reason: 'unsupported' };
  }

  const loaded = await loadSettings();
  if (!loaded) {
    // Deliberately leaves the existing schedule alone. A failed prefs read is
    // usually a dropped connection, and cancelling on that would silently
    // disarm the feature for anyone who opened the app on a bad train.
    return { scheduled: 0, empty: 0, reason: 'settings_unavailable' };
  }

  const { settings, timeZone } = loaded;

  if (!isDigestEnabled(settings)) {
    await clearScheduledDigests();
    return { scheduled: 0, empty: 0, reason: 'disabled' };
  }

  // Checked after the enabled test so that turning the digests off still tears
  // down the schedule even once permission has been revoked in system settings.
  if (!(await hasNotificationPermission())) {
    return { scheduled: 0, empty: 0, reason: 'not_permitted' };
  }

  const plan = planDigests(settings, { now: new Date(), timeZone });
  const range = planQueryRange(plan);
  if (!range) {
    await clearScheduledDigests();
    return { scheduled: 0, empty: 0 };
  }

  const tasks = await loadTasks(range.startISO, range.endISO);
  if (!tasks) {
    // Same reasoning as the settings read: keep yesterday's schedule, which is
    // approximately right, rather than replacing it with nothing.
    return { scheduled: 0, empty: 0, reason: 'tasks_unavailable' };
  }

  await clearScheduledDigests();

  const ids: string[] = [];
  let empty = 0;
  for (const occurrence of plan) {
    const content = contentFor(occurrence, tasks);
    // Nothing to report is not sent at all. See notifications.ts in
    // @do-done/shared for why an empty digest is worse than no digest.
    if (!content) {
      empty += 1;
      continue;
    }
    const id = await scheduleNotification({
      title: content.title,
      body: content.body,
      channel: 'digest',
      at: occurrence.at,
      data: {
        kind: 'digest',
        digest: occurrence.kind,
        startISO: occurrence.startISO,
        endISO: occurrence.endISO,
      },
    });
    if (id) ids.push(id);
  }

  await writeIds(ids);
  return { scheduled: ids.length, empty };
}

/** Post a digest for today right now, so the settings screen can prove it works. */
export async function sendTestDigest(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const loaded = await loadSettings();
  const timeZone = loaded?.timeZone ?? 'America/New_York';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const tasks = (await loadTasks(today, today)) ?? [];
  const content = buildDailyDigest(tasks, today) ?? {
    // The one place an empty digest is worth sending: the user asked for it,
    // and "nothing today" is the correct answer to a button labelled "send one
    // now". Silence here would read as the feature being broken, which is the
    // question the button exists to answer.
    title: 'Today · nothing scheduled',
    body: 'This is what a digest looks like. Real ones are only sent on days with something on them.',
  };

  const id = await scheduleNotification({
    ...content,
    channel: 'digest',
    data: { kind: 'digest', digest: 'daily', startISO: today, endISO: today },
  });
  return id !== null;
}

// ── Lifecycle ──────────────────────────────────────────

let running = false;

/** Re-arm, never overlapping with itself and never throwing at the caller. */
export async function safeRearm(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await rearmDigests();
  } catch {
    // Housekeeping the user didn't ask for by name — never surface it. The
    // next foreground tries again.
  } finally {
    running = false;
  }
}

/**
 * Re-arm on launch and on every return to the foreground.
 *
 * Foreground is the right trigger for the same reason the status-sync sweep
 * uses it: it is the only moment the app reliably notices that a day went past
 * while it was backgrounded, and it is when the armed text is most likely to
 * have gone stale against a task list the user has been editing elsewhere.
 *
 * Returns an unsubscribe function.
 */
export function startDigestScheduling(): () => void {
  void safeRearm();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void safeRearm();
  });
  return () => sub.remove();
}

/** Defaults, re-exported so the settings screen has one import. */
export { DEFAULT_NOTIFICATION_SETTINGS };
