import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  GEOFENCE_COOLDOWN_MINUTES,
  GEOFENCE_DWELL_SECONDS,
  GEOFENCE_MAX_REGIONS,
  type TriggerType,
} from '@do-done/shared';
import { IS_EXPO_GO } from './runtime';
import { supabase } from './supabase';
import { LocationsApi } from '@do-done/api-client';

// expo-notifications was removed from Expo Go in SDK 53; importing it inside
// Expo Go throws at bundle time. Lazy-load only when we're in a real build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Notifications: any = null;
if (!IS_EXPO_GO) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Notifications = require('expo-notifications');
  } catch {
    // not available — geofence handler will be a no-op for notifications
  }
}

export const GEOFENCE_TASK = 'DO_DONE_GEOFENCE';
const ANDROID_CHANNEL_ID = 'location-reminders';

// Both maps live in AsyncStorage rather than module state: the background task
// runs in a fresh JS context after the OS has killed the app, so anything held
// in memory is gone by the time a transition actually fires.
const PENDING_KEY = 'geofence:pending'; // `${locationId}:${trigger}` -> notification ids
const COOLDOWN_KEY = 'geofence:cooldown'; // `${taskId}:${locationId}:${trigger}` -> epoch ms

const CLOSED_STATUSES = new Set(['done', 'cancelled']);

interface GeofenceTaskData {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}

async function readMap<T>(key: string): Promise<Record<string, T>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

async function writeMap<T>(key: string, value: Record<string, T>): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A failed write costs us a duplicate reminder at worst — never throw out
    // of the background task, which the OS treats as a crash.
  }
}

/**
 * Cancel any dwell-delayed notifications still queued for this location, in
 * either direction. Called on every transition: arriving cancels a pending
 * "you left" and vice versa, which is what collapses boundary flapping into a
 * single settled event.
 */
async function cancelPendingFor(locationId: string): Promise<void> {
  if (!Notifications) return;

  const pending = await readMap<string[]>(PENDING_KEY);
  const cooldowns = await readMap<number>(COOLDOWN_KEY);
  let touched = false;

  for (const trigger of ['enter', 'exit'] as TriggerType[]) {
    const key = `${locationId}:${trigger}`;
    const ids = pending[key];
    if (!ids?.length) continue;

    for (const id of ids) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        // already delivered or unknown id — nothing to undo
      }
    }
    delete pending[key];
    touched = true;

    // The cooldown was staked when we scheduled. Since the reminder never
    // fired, release it so the next genuine arrival isn't suppressed.
    for (const cooldownKey of Object.keys(cooldowns)) {
      if (cooldownKey.endsWith(`:${locationId}:${trigger}`)) {
        delete cooldowns[cooldownKey];
      }
    }
  }

  if (touched) {
    await writeMap(PENDING_KEY, pending);
    await writeMap(COOLDOWN_KEY, cooldowns);
  }
}

/** Drop cooldown entries older than the window so the map can't grow forever. */
function pruneCooldowns(cooldowns: Record<string, number>, now: number): void {
  const cutoff = now - GEOFENCE_COOLDOWN_MINUTES * 60_000;
  for (const [key, at] of Object.entries(cooldowns)) {
    if (at < cutoff) delete cooldowns[key];
  }
}

/**
 * Background task that fires when entering/exiting a geofenced location.
 *
 * It does not notify immediately. A raw "enter" fires the moment you clip the
 * boundary, so driving past the shop would fire "Buy milk" — instead every
 * matching task gets a notification scheduled GEOFENCE_DWELL_SECONDS out, and
 * the opposite transition cancels it. Staying put lets it through; passing
 * through does not.
 *
 * IMPORTANT: TaskManager.defineTask MUST be called in global scope (module
 * top-level), not inside React components. We skip registration entirely
 * in Expo Go since the corresponding APIs (background location +
 * notifications) aren't available there.
 */
if (!IS_EXPO_GO) {
  TaskManager.defineTask<GeofenceTaskData>(
    GEOFENCE_TASK,
    async ({ data, error }) => {
      if (error) {
        console.error('[geofence]', error.message);
        return;
      }
      if (!data) return;

      const { eventType, region } = data;
      const triggerType: TriggerType =
        eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit';

      // We always register regions with the location's id as the identifier,
      // so one without it didn't come from us and has nothing to look up.
      const locationId = region.identifier;
      if (!locationId) return;

      try {
        // Settle the opposite direction first — this is also what cancels a
        // pending reminder when the user only clipped the edge.
        await cancelPendingFor(locationId);

        if (!Notifications) return;

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: taskLocations, error: linkError } = await supabase
          .from('task_locations')
          .select('task_id, tasks!inner(id, title, status), locations!inner(name)')
          .eq('location_id', locationId)
          .eq('trigger_type', triggerType);

        if (linkError) {
          console.error('[geofence] link lookup failed', linkError.message);
          return;
        }
        if (!taskLocations || taskLocations.length === 0) return;

        const now = Date.now();
        const cooldowns = await readMap<number>(COOLDOWN_KEY);
        pruneCooldowns(cooldowns, now);
        const pending = await readMap<string[]>(PENDING_KEY);
        const scheduledIds: string[] = [];

        for (const link of taskLocations as unknown as {
          task_id: string;
          tasks: { id: string; title: string; status: string } | null;
          locations: { name: string } | null;
        }[]) {
          const task = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks;
          if (!task || CLOSED_STATUSES.has(task.status)) continue;

          const cooldownKey = `${task.id}:${locationId}:${triggerType}`;
          const lastFired = cooldowns[cooldownKey];
          if (
            lastFired &&
            now - lastFired < GEOFENCE_COOLDOWN_MINUTES * 60_000
          ) {
            continue;
          }

          const locationName =
            (Array.isArray(link.locations) ? link.locations[0] : link.locations)
              ?.name ?? 'a saved location';

          const id = await Notifications.scheduleNotificationAsync({
            content: {
              title:
                triggerType === 'enter'
                  ? `📍 At ${locationName}`
                  : `🚶 Leaving ${locationName}`,
              body: task.title,
              data: { taskId: task.id, locationId },
            },
            trigger: {
              type:
                Notifications.SchedulableTriggerInputTypes?.TIME_INTERVAL ??
                'timeInterval',
              seconds: GEOFENCE_DWELL_SECONDS,
              repeats: false,
              ...(Platform.OS === 'android'
                ? { channelId: ANDROID_CHANNEL_ID }
                : {}),
            },
          });

          scheduledIds.push(id);
          // Staked now rather than on delivery, so a boundary that flaps twice
          // inside the dwell window can't queue the same reminder twice.
          cooldowns[cooldownKey] = now;
        }

        if (scheduledIds.length > 0) {
          pending[`${locationId}:${triggerType}`] = scheduledIds;
          await writeMap(PENDING_KEY, pending);
          await writeMap(COOLDOWN_KEY, cooldowns);
        }
      } catch (e) {
        console.error('[geofence] handler error', e);
      }
    }
  );

  // Without a handler, a notification that fires while the app is foregrounded
  // is swallowed — which is exactly the case when you walk in holding the phone.
  if (Notifications) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    void ensureAndroidChannel();
  }
}

/**
 * Android delivers into a channel, and one that doesn't exist yet gets
 * created implicitly with default importance — silent, no heads-up. Created at
 * module load rather than alongside the permission ask so that users who
 * granted permission in an earlier build still get a properly configured
 * channel. Creating an existing channel is a no-op.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (!Notifications || Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Location reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch (e) {
    console.warn('[geofence] channel setup failed', e);
  }
}

/**
 * Whether we already hold both grants geofencing needs, without showing the
 * user anything. Android splits location into a foreground grant and a
 * separate background one, so both have to be checked.
 */
export async function hasGeofencePermissions(): Promise<boolean> {
  if (Platform.OS === 'web' || IS_EXPO_GO) return false;

  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return false;

  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted;
}

export type GeofencePermissionError =
  | 'unsupported_runtime'
  | 'foreground_denied'
  | 'background_denied'
  | 'notifications_denied';

/**
 * Prompt for everything a location reminder needs, in the order the OS allows.
 *
 * Call this from the flow where the user sets up a location-based reminder —
 * never on launch or sign-in. Up to three system surfaces appear back to back
 * and they are jarring without that context: since Android 11 the OS refuses
 * to show a dialog for background location and instead deep-links into the
 * app's Location permission settings page, where the user has to select
 * "Allow all the time" by hand.
 *
 * Notifications are requested too, and are not optional here — a location
 * reminder that can't post a notification is a feature that silently does
 * nothing (Android 13+ requires the POST_NOTIFICATIONS grant).
 */
export async function requestGeofencePermissions(): Promise<{
  granted: boolean;
  error?: GeofencePermissionError;
}> {
  if (Platform.OS === 'web' || IS_EXPO_GO)
    return { granted: false, error: 'unsupported_runtime' };

  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { granted: false, error: 'foreground_denied' };

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return { granted: false, error: 'background_denied' };

  if (Notifications) {
    await ensureAndroidChannel();
    const existing = await Notifications.getPermissionsAsync();
    const notif = existing.granted
      ? existing
      : await Notifications.requestPermissionsAsync();
    if (!notif.granted) return { granted: false, error: 'notifications_denied' };
  }

  return { granted: true };
}

export interface GeofenceRegistration {
  registered: number;
  /** Locations dropped because the platform caps monitored regions. */
  skipped: number;
  error?: string;
}

/**
 * Re-register all of a user's geofences with the OS.
 * Call after sign-in and whenever locations or their task links change.
 *
 * Never prompts: it reads the user's locations first and bails when there are
 * none, so a user who has set up no location-based reminders is never asked
 * for location access at all. Use `requestGeofencePermissions()` at the point
 * the user actually creates one.
 *
 * Only locations with at least one *open* task are handed to the OS. That
 * keeps finished work from waking the device, and keeps us inside the region
 * cap for longer.
 */
export async function registerUserGeofences(): Promise<GeofenceRegistration> {
  if (Platform.OS === 'web' || IS_EXPO_GO)
    return { registered: 0, skipped: 0 };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { registered: 0, skipped: 0, error: 'not_signed_in' };

  const locApi = new LocationsApi(supabase, user.id);
  const { data: targets, error } = await locApi.listWithPendingTasks();
  if (error) return { registered: 0, skipped: 0, error: error.message };

  // Stop any existing geofencing for our task. Runs before the empty and
  // permission checks below so that completing the last task at a location —
  // or revoking access from system settings — tears down stale regions.
  const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  if (isRunning) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }

  if (targets.length === 0) return { registered: 0, skipped: 0 };

  if (!(await hasGeofencePermissions()))
    return { registered: 0, skipped: 0, error: 'permission_not_granted' };

  // iOS silently stops monitoring past its cap, so trim deliberately and
  // report what was dropped rather than letting regions fail invisibly.
  const cap =
    GEOFENCE_MAX_REGIONS[Platform.OS as keyof typeof GEOFENCE_MAX_REGIONS] ??
    GEOFENCE_MAX_REGIONS.ios;
  const ordered = [...targets].sort(
    (a, b) =>
      b.pendingCount - a.pendingCount ||
      a.location.name.localeCompare(b.location.name)
  );
  const monitored = ordered.slice(0, cap);

  const regions: Location.LocationRegion[] = monitored.map(({ location }) => ({
    identifier: location.id,
    latitude: location.latitude,
    longitude: location.longitude,
    radius: location.radius_meters,
    // Both directions, always — even for a location only anyone is only
    // "arriving" at. The dwell filter cancels a queued reminder when the
    // opposite transition lands, so switching off the unused direction here
    // would mean never hearing about the drive-by we're trying to suppress.
    notifyOnEnter: true,
    notifyOnExit: true,
  }));

  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  return {
    registered: regions.length,
    skipped: ordered.length - monitored.length,
  };
}

export async function stopAllGeofences() {
  if (IS_EXPO_GO) return;
  const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  if (isRunning) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}
