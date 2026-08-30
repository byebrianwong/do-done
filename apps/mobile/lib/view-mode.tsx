/**
 * Which half of a swap tab you are on.
 *
 * Two of the four tabs hold two views each — Today ⟷ Upcoming, All ⟷ Inbox —
 * and only the view you are on is named. The header carries the swap; the tab
 * bar carries a stable label and the current view's *icon*.
 *
 * A module-level store rather than a context, for the same reason
 * `lib/auto-sync-notice.ts` is one: the deep-link routes (`/today`,
 * `/upcoming`, which the home-screen widgets and the launcher shortcuts open)
 * sit *outside* the tab layout and still have to say which half they mean.
 * A provider there would either have to wrap the whole app or be unreachable
 * from exactly the callers that need it.
 *
 * Deliberately not in the query cache: this is navigation, not data, and
 * `invalidateTasks()` sweeps everything under `taskKeys.all`.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AgendaMode = 'today' | 'upcoming';
export type TasksMode = 'all' | 'inbox';

export interface ViewModes {
  agenda: AgendaMode;
  tasks: TasksMode;
}

const AGENDA_KEY = 'nav:mode:agenda';
const TASKS_KEY = 'nav:mode:tasks';

// Both default to the half people live in, so a first launch — and any launch
// where the read fails — opens on Today and All.
let state: ViewModes = { agenda: 'today', tasks: 'all' };

/**
 * Whether anything has set a mode since launch. A deep link into `/upcoming`
 * can land before the stored modes have been read back, and the *link* is the
 * newer instruction — without this the restore would quietly overrule it.
 */
let touched = false;

const subscribers = new Set<() => void>();

function emit(): void {
  for (const cb of subscribers) cb();
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function snapshot(): ViewModes {
  return state;
}

export function setAgendaMode(mode: AgendaMode): void {
  touched = true;
  if (state.agenda === mode) return;
  state = { ...state, agenda: mode };
  emit();
  AsyncStorage.setItem(AGENDA_KEY, mode).catch(() => {});
}

export function setTasksMode(mode: TasksMode): void {
  touched = true;
  if (state.tasks === mode) return;
  state = { ...state, tasks: mode };
  emit();
  AsyncStorage.setItem(TASKS_KEY, mode).catch(() => {});
}

export function toggleAgendaMode(): void {
  setAgendaMode(state.agenda === 'today' ? 'upcoming' : 'today');
}

export function toggleTasksMode(): void {
  setTasksMode(state.tasks === 'all' ? 'inbox' : 'all');
}

/** Read back what the app last opened on. Called once, from the root layout. */
export async function hydrateViewModes(): Promise<void> {
  let stored: [string | null, string | null];
  try {
    stored = (await Promise.all([
      AsyncStorage.getItem(AGENDA_KEY),
      AsyncStorage.getItem(TASKS_KEY),
    ])) as [string | null, string | null];
  } catch {
    // The defaults are a good answer; a failed read must not block the tabs.
    return;
  }
  if (touched) return;
  const [agenda, tasks] = stored;
  const next: ViewModes = {
    agenda: agenda === 'upcoming' ? 'upcoming' : 'today',
    tasks: tasks === 'inbox' ? 'inbox' : 'all',
  };
  if (next.agenda === state.agenda && next.tasks === state.tasks) return;
  state = next;
  emit();
}

/** Test seam. */
export function resetViewModes(): void {
  state = { agenda: 'today', tasks: 'all' };
  touched = false;
  emit();
}

export function useViewMode(): ViewModes {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
