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
import type { CreateLocationInput, Location, TriggerType } from '@do-done/shared';
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

/** A location link as the task editor needs it: the place plus the direction. */
export interface TaskLocationLink {
  location: Location;
  trigger_type: TriggerType;
}

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
      // getTaskLocations embeds the location row; keep only links whose
      // location still resolves (a deleted place cascades, but a stale cache
      // can still hand us one mid-flight).
      return (data as unknown as { locations: Location | null; trigger_type: TriggerType }[])
        .filter((row) => !!row.locations)
        .map((row) => ({ location: row.locations!, trigger_type: row.trigger_type }));
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
