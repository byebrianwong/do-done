/**
 * TanStack Query layer for saved locations and their task links.
 *
 * Mutations are plain functions on the singleton queryClient, matching
 * task-queries.ts — the sheets that call them unmount as soon as the write
 * lands, which would strand a component-scoped useMutation's onSettled.
 *
 * Every write ends in `syncGeofences()`. The OS holds its own copy of the
 * regions, so a change that isn't pushed back down leaves the device
 * monitoring yesterday's set.
 */

import { useQuery } from '@tanstack/react-query';
import type {
  CreateLocationInput,
  Location,
  TaskLocationLink,
  TriggerType,
} from '@do-done/shared';
import type { LocationWithPending } from '@do-done/api-client';
import { getLocationsApi } from './supabase';
import { queryClient } from './query-client';
import { registerUserGeofences } from './geofencing';

export const locationKeys = {
  all: ['locations'] as const,
  list: () => [...locationKeys.all, 'list'] as const,
  pending: () => [...locationKeys.all, 'pending'] as const,
  forTask: (taskId: string) => [...locationKeys.all, 'task', taskId] as const,
};

/**
 * Re-exported so the many `@/lib/location-queries` importers keep working; the
 * type itself now lives in `@do-done/shared`, beside the labels web and mobile
 * both phrase reminders with.
 */
export type { TaskLocationLink };

export function useLocations() {
  return useQuery({
    queryKey: locationKeys.list(),
    queryFn: async () => {
      const api = await getLocationsApi();
      const { data, error } = await api.list();
      if (error) throw error;
      return data;
    },
  });
}

export function useLocationsWithPending() {
  return useQuery({
    queryKey: locationKeys.pending(),
    queryFn: async (): Promise<LocationWithPending[]> => {
      const api = await getLocationsApi();
      const { data, error } = await api.listWithPendingTasks();
      if (error) throw error;
      return data;
    },
  });
}

export function useTaskLocations(taskId: string | null) {
  return useQuery({
    queryKey: locationKeys.forTask(taskId ?? 'none'),
    enabled: !!taskId,
    queryFn: async (): Promise<TaskLocationLink[]> => {
      const api = await getLocationsApi();
      const { data, error } = await api.getTaskLocations(taskId!);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Push the current set of locations-with-open-tasks down to the OS.
 * Failures are swallowed: a geofence that didn't register is a degraded
 * reminder, not a reason to fail the write the user just made.
 */
export async function syncGeofences(): Promise<void> {
  try {
    await registerUserGeofences();
  } catch (e) {
    console.warn('[locations] geofence sync failed', e);
  }
}

const SYNC_DEBOUNCE_MS = 5_000;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalescing version of `syncGeofences`, for callers that fire on every task
 * write — completing the last task at a place should retire its geofence, but
 * a resync costs two queries and typing in the editor invalidates constantly.
 * Bursts collapse into one sync a few seconds after the user stops.
 */
export function scheduleGeofenceSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncGeofences();
  }, SYNC_DEBOUNCE_MS);
}

function invalidateLocations(taskId?: string) {
  void queryClient.invalidateQueries({ queryKey: locationKeys.all });
  if (taskId)
    void queryClient.invalidateQueries({ queryKey: locationKeys.forTask(taskId) });
}

export async function createLocation(
  input: CreateLocationInput
): Promise<Location> {
  const api = await getLocationsApi();
  const { data, error } = await api.create(input);
  if (error) throw error;
  if (!data) throw new Error('Location was not created');
  invalidateLocations();
  await syncGeofences();
  return data;
}

/**
 * Attach a place to a task without filing it under Saved places.
 *
 * The row is real — geofences, notifications and the places screen's cap all
 * work off `locations` — it is simply marked one-off, hidden from the pickers,
 * and swept away by the database when its last task link goes. That sweep is
 * why this doesn't need an undo path: nothing accumulates to clean up.
 */
export async function createOneOffLocation(
  input: Omit<CreateLocationInput, 'is_saved'>
): Promise<Location> {
  return createLocation({ ...input, is_saved: false });
}

/**
 * Promote a one-off place into Saved places — the "actually, keep this one"
 * afterthought. The row keeps its id, so the task links attached to it survive.
 */
export async function saveLocationAsPlace(
  id: string,
  name?: string
): Promise<void> {
  const api = await getLocationsApi();
  const { error } = await api.save(id, name);
  if (error) throw error;
  invalidateLocations();
}

export async function updateLocation(
  id: string,
  patch: Partial<CreateLocationInput>
): Promise<void> {
  const api = await getLocationsApi();
  const { error } = await api.update(id, patch);
  if (error) throw error;
  invalidateLocations();
  // A radius or coordinate change means the registered region is wrong, not
  // just the cached copy.
  await syncGeofences();
}

export async function deleteLocation(id: string): Promise<void> {
  const api = await getLocationsApi();
  const { error } = await api.remove(id);
  if (error) throw error;
  invalidateLocations();
  await syncGeofences();
}

export async function linkTaskLocation(
  taskId: string,
  locationId: string,
  trigger: TriggerType
): Promise<void> {
  const api = await getLocationsApi();
  const { error } = await api.linkTask(taskId, locationId, trigger);
  if (error) throw error;
  invalidateLocations(taskId);
  await syncGeofences();
}

export async function unlinkTaskLocation(
  taskId: string,
  locationId: string,
  trigger: TriggerType
): Promise<void> {
  const api = await getLocationsApi();
  const { error } = await api.unlinkTask(taskId, locationId, trigger);
  if (error) throw error;
  invalidateLocations(taskId);
  await syncGeofences();
}
