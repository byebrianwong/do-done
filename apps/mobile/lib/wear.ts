/**
 * Keeping the watch in step with the phone.
 *
 * The phone is the only thing here that can read the Supabase session, so it is
 * the only thing that can hand the watch credentials. Everything below is that
 * one job: build a snapshot, put it and the session on the Data Layer, and do it
 * often enough that the watch's access token is still valid when someone raises
 * their wrist.
 *
 * Three triggers, and they are not interchangeable:
 *
 * - **Every task write**, debounced, through `invalidateTasks()`. Same
 *   chokepoint the widget refresh and the geofence sync hang off.
 * - **Every foreground**, from `app/_layout.tsx`. A phone opened after a night
 *   asleep has a token the watch does not.
 * - **The watch asking**, as a headless task. The one that covers a phone that
 *   has not been opened in hours, which is exactly when a watch is most useful.
 *
 * Android-only and inert in Expo Go, like `lib/widgets.ts`: the native module
 * that does the put is not in the Go runtime.
 */

import { AppState, Platform } from 'react-native';
import { IS_EXPO_GO } from '@/lib/runtime';
import { clearWatch, syncToWatch } from '@/modules/dodone-wear';

const DEBOUNCE_MS = 800;
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * Syncs run one at a time, in the order they were asked for.
 *
 * The same shape as `completionChains` in `lib/task-queries.ts`, and for a
 * related reason: two runs in flight would put two snapshots and the watch would
 * keep whichever arrived second, which is not necessarily the newer one.
 *
 * **Every caller gets a promise for its own run, not for the one already
 * going.** That matters for the headless task: its JS context is torn down when
 * the task resolves, so a caller handed a promise that resolved early would take
 * the sync it was waiting for down with it.
 */
let chain: Promise<boolean> = Promise.resolve(false);

/**
 * What the watch signs its own writes with.
 *
 * The refresh token is deliberately **not** here. Supabase rotates a refresh
 * token when it is spent, so two clients holding the same one sign each other
 * out — the watch would take the phone down with it, silently, an hour after
 * pairing. The watch gets an access token instead and lives with its expiry;
 * `WearSyncRequestService` is how it asks for the next one.
 */
interface WearSession {
  url: string;
  anonKey: string;
  accessToken: string;
  /** Epoch ms. The watch stops writing past this rather than sending a 401. */
  expiresAt: number;
  userId: string;
}

/**
 * Push a fresh snapshot to the watch, debounced.
 *
 * Fire-and-forget: never blocks the caller and never throws. A failed sync
 * leaves the watch on the snapshot it has, which says how old it is.
 */
export function scheduleWatchSync(): void {
  if (!enabled()) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void syncWatchNow();
  }, DEBOUNCE_MS);
}

/**
 * Build and push a snapshot right now.
 *
 * Called directly by the foreground hook and by the headless task the watch
 * wakes, both of which are answering a question rather than reacting to a burst
 * of writes and so have nothing to debounce.
 */
export function syncWatchNow(): Promise<boolean> {
  if (!enabled()) return Promise.resolve(false);
  // Both arms are the same call: a failed run must not stop the next one, and
  // an unhandled rejection here would surface in a background task with nothing
  // to catch it.
  chain = chain.then(runSync, runSync);
  return chain;
}

async function runSync(): Promise<boolean> {
  try {
    return await doSync();
  } catch {
    // The watch keeps the snapshot it has, which says how old it is.
    return false;
  }
}

/**
 * Apply a write the watch sent, then send a fresh snapshot.
 *
 * The one entry point the headless task calls. **The snapshot goes out whether
 * the write succeeded or not**, and that ordering is the point: a failed write
 * leaves the watch showing a row it thinks it removed, and only a snapshot puts
 * it back. Returning early on failure would leave the two disagreeing until
 * something else happened to sync.
 */
export async function runWearTask(data?: { write?: string }): Promise<boolean> {
  if (!enabled()) return false;
  try {
    const { parseWearWrite } = await import('@/lib/wear-write');
    const write = parseWearWrite(data?.write);
    if (write) await applyWearWrite(write);
  } catch {
    // An unapplied write is corrected by the snapshot below.
  }
  return syncWatchNow();
}

async function applyWearWrite(
  write: import('@/lib/wear-write').WearWrite
): Promise<void> {
  const { getProjectsApi, getTasksApi } = await import('@/lib/supabase');
  const { wearCreateInput } = await import('@/lib/wear-write');

  const tasks = await getTasksApi();
  if (write.op === 'complete') {
    await tasks.complete(write.taskId);
    return;
  }
  if (write.op === 'reschedule') {
    await tasks.update(write.taskId, { scheduled_date: write.value });
    return;
  }

  // The project list is what lets `#groceries` in a dictated task file into the
  // Groceries project rather than becoming a tag. A failed read means every
  // token stays a tag, which is what `parseTaskInput` does without a list — a
  // duller result, not a wrong one, and better than refusing the task.
  let projects: Awaited<ReturnType<
    Awaited<ReturnType<typeof getProjectsApi>>['list']
  >>['data'] = [];
  try {
    const api = await getProjectsApi();
    const res = await api.list();
    if (!res.error) projects = res.data;
  } catch {
    // fall through with an empty list
  }
  await tasks.create(wearCreateInput(write.value, projects));
}

/**
 * Sync now, and again on every return to the foreground.
 *
 * The foreground trigger is about the token, not the tasks. A phone opened
 * after a night asleep holds a session the watch's copy expired out of hours
 * ago, and this is the cheapest moment to hand over the new one — the app is
 * awake and the user is already looking at it.
 *
 * Mirrors `startStatusSyncSweeps`, including returning its own teardown.
 */
export function startWatchSync(): () => void {
  void syncWatchNow();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncWatchNow();
  });
  return () => sub.remove();
}

/**
 * Drop what the watch is holding.
 *
 * Called on sign-out. The data items carry a task list and an access token, so
 * leaving them on a paired watch would show the previous account's day to
 * whoever picks it up — the same reasoning as clearing the query cache.
 */
export async function clearWatchData(): Promise<void> {
  if (!enabled()) return;
  await clearWatch();
}

function enabled(): boolean {
  return Platform.OS === 'android' && !IS_EXPO_GO;
}

async function doSync(): Promise<boolean> {
  // Loaded lazily for the reason `widget-task-handler.ts` gives: this runs in a
  // headless context with the app dead, and Supabase plus the API client is the
  // heaviest thing on the path. Nothing above this line pulls it in.
  //
  // `await import` rather than `require`, which is what `lib/widgets.ts` uses:
  // that one is called from a synchronous function and has no choice, and the
  // cost of the choice is that its body cannot be exercised outside Metro.
  const [{ supabase }, { loadWidgetTasks }, { buildWearSnapshot }] =
    await Promise.all([
      import('@/lib/supabase'),
      import('@/widgets/widget-data'),
      import('@/lib/wear-snapshot'),
    ]);

  // `getSession()` reads local storage and refreshes if the client decides it
  // is due, which is the whole reason the watch wakes the phone rather than
  // refreshing itself.
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.user) {
    // Signed out on the phone means signed out on the wrist. Clearing rather
    // than leaving the last snapshot up, for the reason `clearWatchData` gives.
    await clearWatch();
    return false;
  }

  const tasks = await loadWidgetTasks();
  if (tasks.signedOut) {
    await clearWatch();
    return false;
  }

  const snapshot = buildWearSnapshot({
    tasks: tasks.tasks,
    projects: tasks.projects,
  });

  const payload: WearSession = {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    accessToken: session.access_token,
    // Supabase reports `expires_at` in seconds; everything on the watch side is
    // epoch ms, so the conversion happens once, here.
    expiresAt: (session.expires_at ?? 0) * 1000,
    userId: session.user.id,
  };

  return syncToWatch(JSON.stringify(snapshot), JSON.stringify(payload));
}
