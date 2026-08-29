import { Platform } from 'react-native';
import { IS_EXPO_GO } from './runtime';

/**
 * The one seam onto `expo-notifications`.
 *
 * Everything that posts a notification — the geofence task, the digest
 * scheduler, the settings screen's test button — goes through here, for three
 * reasons the app has already paid for once each:
 *
 * 1. **The module can't be imported statically.** expo-notifications was
 *    removed from Expo Go in SDK 53, and importing it there throws at *bundle*
 *    time, taking the whole app down rather than the one feature. Every entry
 *    point lazy-requires it behind `IS_EXPO_GO`.
 * 2. **Android delivers into a channel, and a channel that doesn't exist yet
 *    is created implicitly with default importance** — silent, no heads-up, no
 *    sound. A notification posted to a missing channel doesn't fail; it just
 *    quietly doesn't get noticed, which is indistinguishable from the feature
 *    being broken.
 * 3. **`cancelAllScheduledNotificationsAsync()` must never be called.** The
 *    geofence dwell filter works by scheduling a reminder a couple of minutes
 *    out and cancelling it if you leave, so at any moment there may be a
 *    pending notification that *is* the location feature. A digest re-arm that
 *    cleared everything would silently eat it. Both schedulers track their own
 *    identifiers and cancel only those.
 *
 * This module deliberately imports nothing but `react-native` and `./runtime`.
 * It is pulled in from `index.js`, the bundle entry, where every static import
 * is paid for on every cold start — including the headless ones a launcher
 * widget update runs. See the comment there.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotificationsModule = any;

let cached: NotificationsModule | null | undefined;

/** The module, or null in Expo Go / on web / if the native side is missing. */
export function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (IS_EXPO_GO || Platform.OS === 'web') {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications');
  } catch {
    cached = null;
  }
  return cached;
}

/** True when notifications can be posted at all in this runtime. */
export function notificationsSupported(): boolean {
  return getNotifications() !== null;
}

// ── Channels ───────────────────────────────────────────
//
// Three, not one. Android lets the user silence a channel without silencing the
// app, and "a reminder because I walked into a shop", "a summary of my
// morning" and "the task I set for 3pm is at 3pm" are genuinely different
// subscriptions — someone may well want the timely ones at high importance and
// the summary quiet. One shared channel would make muting the digest also mute
// the thing they're standing in front of.

export const LOCATION_CHANNEL_ID = 'location-reminders';
export const DIGEST_CHANNEL_ID = 'digests';
export const TASK_CHANNEL_ID = 'task-reminders';

/** The channel a notification of this kind belongs in. */
export type NotificationChannel = 'location' | 'digest' | 'task';

const CHANNEL_IDS: Record<NotificationChannel, string> = {
  location: LOCATION_CHANNEL_ID,
  digest: DIGEST_CHANNEL_ID,
  task: TASK_CHANNEL_ID,
};

export function channelIdFor(kind: NotificationChannel): string {
  return CHANNEL_IDS[kind];
}

let channelsReady: Promise<void> | null = null;

/**
 * Create all three channels. Idempotent (creating an existing channel is a no-op),
 * memoised per JS context, and safe to call from a background task.
 *
 * Called at module load from the entry point rather than alongside the
 * permission prompt, so a user who granted permission in an earlier build —
 * before a channel existed, or before it had the right importance — still
 * gets a properly configured one.
 */
export function ensureChannels(): Promise<void> {
  if (channelsReady) return channelsReady;
  channelsReady = (async () => {
    const N = getNotifications();
    if (!N || Platform.OS !== 'android') return;
    try {
      await N.setNotificationChannelAsync(LOCATION_CHANNEL_ID, {
        name: 'Location reminders',
        description: 'Tasks tied to a place, when you arrive or leave.',
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
      await N.setNotificationChannelAsync(DIGEST_CHANNEL_ID, {
        name: 'Daily and weekly digests',
        description: "A summary of what's on today, and of the week ahead.",
        // DEFAULT, not HIGH: a digest is worth a sound and a place in the
        // shade, but it is not worth interrupting whatever is on screen. A
        // heads-up banner every morning is what gets a channel muted.
        importance: N.AndroidImportance.DEFAULT,
      });
      await N.setNotificationChannelAsync(TASK_CHANNEL_ID, {
        name: 'Task reminders',
        description: 'Scheduled tasks, when the time you set for them arrives.',
        // HIGH, like the location channel and unlike the digest. A reminder
        // whose whole value is landing at 2:55 for a 3pm task is worth
        // interrupting for; arriving silently in the shade an hour later is
        // the same as not arriving. The day-start roundup shares the channel
        // because it is the same subscription — "announce my scheduled work"
        // — and splitting it would mean a fourth thing to explain for a
        // notification that fires once a day.
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 150, 200],
      });
    } catch (e) {
      console.warn('[notifications] channel setup failed', e);
    }
  })();
  return channelsReady;
}

let handlerInstalled = false;

/**
 * Show notifications that fire while the app is foregrounded.
 *
 * Without a handler they are swallowed, which is exactly the case when you
 * walk into the shop holding the phone with DoDone open — the one moment the
 * location reminder is most obviously supposed to work.
 */
export function installNotificationHandler(): void {
  if (handlerInstalled) return;
  const N = getNotifications();
  if (!N) return;
  handlerInstalled = true;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// ── Permission ─────────────────────────────────────────

/** Whether we already hold the notification grant, without prompting. */
export async function hasNotificationPermission(): Promise<boolean> {
  const N = getNotifications();
  if (!N) return false;
  try {
    const { granted } = await N.getPermissionsAsync();
    return granted === true;
  } catch {
    return false;
  }
}

/**
 * Ask for the notification grant, creating the channels first.
 *
 * Channels before the prompt on purpose: Android shows the user the channels
 * an app has when they make the decision, so creating them afterwards means
 * the one dialog that matters is the least informative it could be.
 *
 * Android 13+ requires POST_NOTIFICATIONS; below that the grant is implicit
 * and this resolves true without showing anything.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const N = getNotifications();
  if (!N) return false;
  try {
    await ensureChannels();
    const existing = await N.getPermissionsAsync();
    if (existing.granted) return true;
    const asked = await N.requestPermissionsAsync();
    return asked.granted === true;
  } catch {
    return false;
  }
}

// ── Posting ────────────────────────────────────────────

export interface ScheduleOptions {
  title: string;
  body: string;
  channel: NotificationChannel;
  /** Absolute instant to fire at. Omit to post immediately. */
  at?: Date;
  /** Rides along to the tap handler — see `lib/notification-routing.ts`. */
  data?: Record<string, unknown>;
}

/**
 * Schedule one notification and return its identifier, or null if it could not
 * be scheduled. The identifier is the only handle there is for cancelling a
 * single notification, so every caller that may need to take one back has to
 * keep it — see the note about `cancelAllScheduledNotificationsAsync` above.
 */
export async function scheduleNotification(
  opts: ScheduleOptions
): Promise<string | null> {
  const N = getNotifications();
  if (!N) return null;
  await ensureChannels();

  const channelId = channelIdFor(opts.channel);
  try {
    return await N.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        data: opts.data ?? {},
        ...(Platform.OS === 'android' ? { channelId } : {}),
      },
      trigger: opts.at
        ? {
            type: N.SchedulableTriggerInputTypes?.DATE ?? 'date',
            date: opts.at,
            ...(Platform.OS === 'android' ? { channelId } : {}),
          }
        : // `null` is expo-notifications' "deliver now". A zero-second
          // interval trigger is rejected, so this is not the same thing as
          // scheduling for the current instant.
          null,
    });
  } catch (e) {
    console.warn('[notifications] schedule failed', e);
    return null;
  }
}

/** Cancel specific scheduled notifications. Unknown ids are ignored. */
export async function cancelNotifications(ids: string[]): Promise<void> {
  const N = getNotifications();
  if (!N || ids.length === 0) return;
  for (const id of ids) {
    try {
      await N.cancelScheduledNotificationAsync(id);
    } catch {
      // Already delivered, or an id from a previous install — nothing to undo.
    }
  }
}
