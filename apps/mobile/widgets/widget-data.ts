/**
 * The one network-shaped thing a task widget does: read the signed-in user's
 * active tasks and their projects.
 *
 * Kept apart from `widget-layout.ts` so the grouping and fitting can be tested
 * in node — this module reaches for `@/lib/supabase`, which in a headless
 * widget context is the module most likely to be unconstructable.
 */

import type { Project, Task } from '@do-done/shared';
import { addDaysLocalISO } from '@do-done/shared';
import { supabase, getTasksApi, getProjectsApi } from '@/lib/supabase';
import { UPCOMING_HORIZON_DAYS } from './widget-layout';

/** Either a signed-out marker or the fetched active tasks and projects. */
export type WidgetTasks =
  | { signedOut: true }
  | { signedOut: false; tasks: Task[]; projects: Project[] };

/**
 * Load active tasks and projects for a widget render, or a signed-out marker.
 * Auth is read from the local session (AsyncStorage) — no network round-trip
 * just to learn whether we're signed in.
 *
 * **Projects failing is not tasks failing.** The project list feeds the row's
 * ring; without it every ring falls back to neutral, which is a duller widget
 * but still a correct one. Letting that failure take the task list with it
 * would turn a cosmetic outage into an empty home screen.
 */
export async function loadWidgetTasks(): Promise<WidgetTasks> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return { signedOut: true };
  try {
    const [tasks, projects] = await Promise.all([
      loadTasks(),
      loadProjects(),
    ]);
    return { signedOut: false, tasks, projects };
  } catch {
    return { signedOut: false, tasks: [], projects: [] };
  }
}

/**
 * The rows every task widget and the watch draw from, asked for by what they
 * are rather than as a page by sort order.
 *
 * This used to be the first 200 tasks by `sort_order`, finished ones included,
 * so an account past 200 tasks lost whatever the order put after that, even if
 * it was scheduled today. `listOpen` reads every open task dated through the
 * end of the Upcoming widget's horizon, plus one day so the watch's view of
 * tomorrow is complete too. Its undated and later rows are read highest
 * priority first, and the tasks finished since local midnight come along for
 * the watch's progress count.
 */
export function widgetTaskQuery(now: Date = new Date()): {
  datedThrough: string;
  completedSince: string;
} {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    datedThrough: addDaysLocalISO(UPCOMING_HORIZON_DAYS + 1, now),
    completedSince: midnight.toISOString(),
  };
}

async function loadTasks(): Promise<Task[]> {
  const api = await getTasksApi();
  const { data, error } = await api.listOpen(widgetTaskQuery());
  if (error) return [];
  return data;
}

async function loadProjects(): Promise<Project[]> {
  try {
    const api = await getProjectsApi();
    const { data, error } = await api.list();
    if (error) return [];
    return data;
  } catch {
    return [];
  }
}
