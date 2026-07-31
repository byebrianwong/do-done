import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { IS_EXPO_GO } from './runtime';
import { supabase } from './supabase';
import { LocationsApi, TasksApi } from '@do-done/api-client';

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

interface GeofenceTaskData {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}

/**
 * Background task that fires when entering/exiting a geofenced location.
 * Looks up tasks linked to that location and posts a local notification.
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
      const triggerType =
        eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit';

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const tasksApi = new TasksApi(supabase, user.id);

        // Find task_locations rows for this location + trigger type
        const { data: taskLocations } = await supabase
          .from('task_locations')
          .select('task_id, locations(name)')
          .eq('location_id', region.identifier)
          .eq('trigger_type', triggerType);

        if (!taskLocations || taskLocations.length === 0) return;

        for (const link of taskLocations) {
          const { data: task } = await tasksApi.getById(link.task_id);
          if (!task || task.status === 'done' || task.status === 'cancelled')
            continue;

          const locationName =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (link as any).locations?.name ?? 'a saved location';

          if (Notifications) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title:
                  triggerType === 'enter'
                    ? `📍 At ${locationName}`
                    : `🚶 Leaving ${locationName}`,
                body: task.title,
                data: { taskId: task.id },
              },
              trigger: null, // immediate
            });
          }
        }
      } catch (e) {
        console.error('[geofence] handler error', e);
      }
    }
  );
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

/**
 * Prompt for the permissions geofencing needs, foreground first.
 *
 * Call this from the flow where the user sets up a location-based reminder —
 * never on launch or sign-in. Two system surfaces appear back to back and the
 * second one is jarring without that context: since Android 11 the OS refuses
 * to show a dialog for background location and instead deep-links into the
 * app's Location permission settings page, where the user has to select
 * "Allow all the time" by hand.
 */
export async function requestGeofencePermissions(): Promise<{
  granted: boolean;
  error?: string;
}> {
  if (Platform.OS === 'web' || IS_EXPO_GO)
    return { granted: false, error: 'unsupported_runtime' };

  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { granted: false, error: 'foreground_denied' };

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return { granted: false, error: 'background_denied' };

  return { granted: true };
}

/**
 * Re-register all of a user's geofences with the OS.
 * Call after sign-in and whenever locations change.
 *
 * Never prompts: it reads the user's locations first and bails when there are
 * none, so a user who has set up no location-based reminders is never asked
 * for location access at all. Use `requestGeofencePermissions()` at the point
 * the user actually creates one.
 */
export async function registerUserGeofences(): Promise<{
  registered: number;
  error?: string;
}> {
  if (Platform.OS === 'web' || IS_EXPO_GO) return { registered: 0 };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { registered: 0, error: 'not_signed_in' };

  const locApi = new LocationsApi(supabase, user.id);
  const { data: locations, error } = await locApi.list();
  if (error) return { registered: 0, error: error.message };

  // Stop any existing geofencing for our task. Runs before the empty and
  // permission checks below so that deleting every location — or revoking
  // access from system settings — tears down the stale regions.
  const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  if (isRunning) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }

  if (locations.length === 0) return { registered: 0 };

  if (!(await hasGeofencePermissions()))
    return { registered: 0, error: 'permission_not_granted' };

  const regions: Location.LocationRegion[] = locations.map((l) => ({
    identifier: l.id,
    latitude: l.latitude,
    longitude: l.longitude,
    radius: l.radius_meters,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));

  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
  return { registered: regions.length };
}

export async function stopAllGeofences() {
  if (IS_EXPO_GO) return;
  const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  if (isRunning) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}
