import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { GEOFENCE_MAX_REGIONS } from '@do-done/shared';
import { IS_EXPO_GO } from './runtime';
import { supabase } from './supabase';
import { LocationsApi } from '@do-done/api-client';
import {
  ensureChannels,
  getNotifications,
  requestNotificationPermission,
} from './notifications';
// Importing this module is what defines the background task. It is ALSO
// imported from `index.js` — that import is the one that matters, since this
// module is only ever reached from inside the React tree and the OS delivers
// geofence events with no React tree at all. See geofence-task.ts.
import { GEOFENCE_TASK } from './geofence-task';

export { GEOFENCE_TASK };

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
 * The user's position, but only if reading it is free: no prompt, no fix,
 * no wait. Returns null the moment either would be needed.
 *
 * This is what biases place search towards where you are and puts the "you"
 * dot on the map preview. Both are improvements on a screen the user opened to
 * do something else, so neither may interrupt: opening the 📍 row must not
 * raise a permission dialog, and a cold GPS must not stall the suggestions.
 * `getLastKnownPositionAsync` returns the OS's cached fix or nothing at all.
 */
export async function getLastKnownPosition(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  if (Platform.OS === 'web') return null;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return null;
    const last = await Location.getLastKnownPositionAsync();
    if (!last) return null;
    return {
      latitude: last.coords.latitude,
      longitude: last.coords.longitude,
    };
  } catch {
    return null;
  }
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

  if (getNotifications()) {
    await ensureChannels();
    if (!(await requestNotificationPermission()))
      return { granted: false, error: 'notifications_denied' };
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
