import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Type-only, so it erases at compile and costs nothing at load. The dwell and
// cooldown *values* come from the same package but are pulled in dynamically
// inside the handler — see the note below on what static imports cost here.
import type { TriggerType } from '@do-done/shared';
import { IS_EXPO_GO } from './runtime';
import {
  cancelNotifications,
  channelIdFor,
  ensureChannels,
  getNotifications,
} from './notifications';

/**
 * The geofence background task, and NOTHING ELSE.
 *
 * `TaskManager.defineTask` MUST be called during **bundle evaluation** — not
 * from a component, and not from a module that only a component pulls in. When
 * the OS detects a boundary crossing it starts the JS runtime with no activity
 * and no React tree, then looks the task up **by name**. A task that has not
 * been defined by then is not deferred; the event is dropped, expo-task-manager
 * logs "Task 'DO_DONE_GEOFENCE' has not been registered" somewhere nobody is
 * looking, and the reminder simply never arrives.
 *
 * That is exactly what was happening. The definition lived in
 * `lib/geofencing.ts`, which is imported only from `app/_layout.tsx`,
 * `lib/location-queries.ts` and `components/LocationReminderSheet.tsx` — all
 * inside the React tree. Expo Router loads route modules through
 * `require.context`, whose entries are lazy getters, so `_layout.tsx` evaluates
 * only when the router renders. Location reminders therefore fired only while
 * the app happened to be warm and on screen, and never in the case the whole
 * feature exists for: the phone in a pocket, the app closed, walking into a
 * shop. Identical to the bug that left the home-screen widgets blank; see the
 * comment in `index.js`, which is where this module is now imported from.
 *
 * Hence the import list above. Everything reachable from this module's static
 * imports has to load in that cold headless context, and — because `index.js`
 * is also what a launcher widget update evaluates — it is paid for on **every**
 * cold start, geofence event or not. So the static half is deliberately tiny:
 * two native module wrappers, AsyncStorage, and two local files with no
 * dependencies of their own.
 *
 * `./supabase`, `@do-done/api-client` and the *values* from `@do-done/shared`
 * are behind `await import(...)` inside the handler for that reason. The last
 * one matters more than it looks: `@do-done/shared` is a barrel, so importing
 * one number from it statically would evaluate every module behind it — the
 * Zod schemas and the ~245 KB generated Phosphor icon table included — before a
 * widget could draw a tile that needs none of them. Same discipline as
 * `widgets/widget-task-handler.ts`, and the same reason.
 */

export const GEOFENCE_TASK = 'DO_DONE_GEOFENCE';

// Both maps live in AsyncStorage rather than module state: the background task
// runs in a fresh JS context after the OS has killed the app, so anything held
// in memory is gone by the time a transition actually fires.
const PENDING_KEY = 'geofence:pending'; // `${locationId}:${trigger}` -> notification ids
const COOLDOWN_KEY = 'geofence:cooldown'; // `${taskId}:${locationId}:${trigger}` -> epoch ms

const CLOSED_STATUSES = new Set(['done', 'cancelled', 'archived']);

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
  const pending = await readMap<string[]>(PENDING_KEY);
  const cooldowns = await readMap<number>(COOLDOWN_KEY);
  let touched = false;

  for (const trigger of ['enter', 'exit'] as TriggerType[]) {
    const key = `${locationId}:${trigger}`;
    const ids = pending[key];
    if (!ids?.length) continue;

    await cancelNotifications(ids);
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

/**
 * Drop cooldown entries older than the window so the map can't grow forever.
 * `cooldownMs` is passed in rather than read from `@do-done/shared` here — see
 * the note on static imports above.
 */
function pruneCooldowns(
  cooldowns: Record<string, number>,
  now: number,
  cooldownMs: number
): void {
  const cutoff = now - cooldownMs;
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

        const N = getNotifications();
        if (!N) return;

        const [{ supabase }, { GEOFENCE_COOLDOWN_MINUTES, GEOFENCE_DWELL_SECONDS }] =
          await Promise.all([import('./supabase'), import('@do-done/shared')]);
        const cooldownMs = GEOFENCE_COOLDOWN_MINUTES * 60_000;

        // `getSession()`, deliberately not `getUser()`. getUser() round-trips
        // to the auth server; this handler runs on a phone that has just been
        // woken in someone's pocket, possibly with no usable connection, and a
        // failed auth call there means no reminder at all. getSession() reads
        // the session straight out of AsyncStorage, which is where the app put
        // it. The queries below still authenticate — an expired token fails
        // them, not the whole handler, and the reminder is retried on the next
        // transition.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) return;

        const { data: taskLocations, error: linkError } = await supabase
          .from('task_locations')
          .select(
            'task_id, tasks!inner(id, title, status, deleted_at), locations!inner(name)'
          )
          .eq('location_id', locationId)
          .eq('trigger_type', triggerType);

        if (linkError) {
          console.error('[geofence] link lookup failed', linkError.message);
          return;
        }
        if (!taskLocations || taskLocations.length === 0) return;

        const now = Date.now();
        const cooldowns = await readMap<number>(COOLDOWN_KEY);
        pruneCooldowns(cooldowns, now, cooldownMs);
        const pending = await readMap<string[]>(PENDING_KEY);
        const scheduledIds: string[] = [];

        await ensureChannels();

        for (const link of taskLocations as unknown as {
          task_id: string;
          tasks: {
            id: string;
            title: string;
            status: string;
            deleted_at: string | null;
          } | null;
          locations: { name: string } | null;
        }[]) {
          const task = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks;
          if (!task || CLOSED_STATUSES.has(task.status)) continue;
          // A soft-deleted task keeps its rows, `task_locations` included, so
          // without this a task deleted an hour ago still greets you at the
          // shop. Every read in TasksApi carries the same filter; this query
          // doesn't go through it. See CLAUDE.md → Deleting a task.
          if (task.deleted_at) continue;

          const cooldownKey = `${task.id}:${locationId}:${triggerType}`;
          const lastFired = cooldowns[cooldownKey];
          if (lastFired && now - lastFired < cooldownMs) continue;

          const locationName =
            (Array.isArray(link.locations) ? link.locations[0] : link.locations)
              ?.name ?? 'a saved location';

          const id = await N.scheduleNotificationAsync({
            content: {
              title:
                triggerType === 'enter'
                  ? `📍 At ${locationName}`
                  : `🚶 Leaving ${locationName}`,
              body: task.title,
              // Read by the tap handler in `lib/notification-routing.ts`, which
              // opens the task rather than dropping the user on whatever screen
              // the app was last showing.
              data: { taskId: task.id, locationId, kind: 'location' },
              channelId: channelIdFor('location'),
            },
            trigger: {
              type:
                N.SchedulableTriggerInputTypes?.TIME_INTERVAL ?? 'timeInterval',
              seconds: GEOFENCE_DWELL_SECONDS,
              repeats: false,
              channelId: channelIdFor('location'),
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
}

// Nothing else runs at module scope on purpose. The foreground presentation
// handler and the channel setup used to, and both are concerns of an app that
// is actually running: `app/_layout.tsx` installs them on mount. Doing it here
// would `require('expo-notifications')` on every cold start — a launcher widget
// repaint included — to configure something only a live app can use. The
// handler below still calls `ensureChannels()` before it schedules, so a
// notification posted from a cold background start is never the one that
// creates a channel implicitly.
