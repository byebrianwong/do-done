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
          if (!task || task.status === 'done' || task.status === 'archived')
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
 * Re-register all of a user's geofences with the OS.
 * Call after sign-in and whenever locations change.
 */
export async function registerUserGeofences(): Promise<{
  registered: number;
  error?: string;
}> {
  if (Platform.OS === 'web' || IS_EXPO_GO) return { registered: 0 };

  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { registered: 0, error: 'foreground_denied' };

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return { registered: 0, error: 'background_denied' };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { registered: 0, error: 'not_signed_in' };

  const locApi = new LocationsApi(supabase, user.id);
  const { data: locations, error } = await locApi.list();
  if (error) return { registered: 0, error: error.message };

  // Stop any existing geofencing for our task
  const isRunning = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  if (isRunning) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }

  if (locations.length === 0) return { registered: 0 };

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
