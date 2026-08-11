"use client";

import { todayLocalISO, type CalendarEvent, type Project, type Task } from "@do-done/shared";
import { buildDemoSeed } from "./seed";

/**
 * The sandbox's database: one object in memory, mirrored into sessionStorage.
 *
 * sessionStorage rather than localStorage on purpose — a demo should start
 * clean for a new visitor but survive a reload and a tab-to-tab wander through
 * the app. Two tabs are two independent sandboxes, which is also what makes it
 * safe to hand the link to a room full of people at once.
 *
 * The snapshot is immutable: every write replaces the whole state object, so
 * `useSyncExternalStore` sees a new reference and the views re-render. This is
 * what stands in for the `router.refresh()` the real app relies on — a refresh
 * in the sandbox re-runs a server component that has nothing to say.
 */

const STORAGE_KEY = "dodone.demo.v1";

export interface DemoState {
  tasks: Task[];
  projects: Project[];
  events: CalendarEvent[];
  /** The day the data was seeded for. A stale snapshot re-seeds rather than
   *  presenting last week's "today" as today. */
  seededFor: string;
}

function freshState(today = todayLocalISO()): DemoState {
  const seed = buildDemoSeed(today);
  return { ...seed, seededFor: today };
}

let state: DemoState = freshState();
let hydrated = false;
const listeners = new Set<() => void>();

/**
 * How many holds are outstanding, and whether a write landed under one.
 *
 * A write and a re-render are two events in the real app and one here, and
 * conflating them is what made the completion animation invisible in the
 * sandbox. Completing a task writes to Postgres immediately, but the list is a
 * server render: it changes only when `router.refresh()` runs, and
 * `task-item.tsx` deliberately defers that until the row has finished
 * collapsing. In the sandbox the write *was* the refresh, firing synchronously,
 * so the row was pulled out from under its own exit — measured at 18ms into a
 * 680ms envelope, with the halo and the sparks unmounted alongside it. On a
 * surface that keeps completed rows the row survived but re-mounted, which
 * reset both moments to nothing about 120ms in.
 *
 * So the notification is what waits, never the write: `state` and
 * sessionStorage are current the whole time, and a reload mid-hold shows the
 * truth. Only the subscribers are told late.
 */
let holds = 0;
let missedEmit = false;

function flush() {
  missedEmit = false;
  for (const l of listeners) l();
}

function emit() {
  if (holds > 0) {
    missedEmit = true;
    return;
  }
  flush();
}

/**
 * Keep subscribers on the current snapshot for `ms`, then tell them everything
 * at once.
 *
 * Held by the writes a row animates its way out of — see `DemoTasksApi`. Holds
 * nest and each releases on its own timer, so a second completion moments later
 * extends the quiet rather than cutting the first one short.
 *
 * A no-op under reduced motion: the hold exists only to protect an animation,
 * and there isn't one to protect — `useRowExit` skips the whole timeline
 * and drops the row on the spot, which a delayed list would then contradict by
 * showing it again.
 */
export function holdDemoNotifications(ms: number): void {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  holds += 1;
  setTimeout(() => {
    holds -= 1;
    if (holds === 0 && missedEmit) flush();
  }, ms);
}

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota. The sandbox still works, it just forgets on reload.
  }
}

/**
 * Adopt any saved sandbox for today. Called once, from an effect — never
 * during render, so the server's HTML and the first client render agree and
 * the swap happens as a normal update afterwards.
 */
export function hydrateDemoStore(): void {
  if (hydrated) return;
  hydrated = true;
  const today = todayLocalISO();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as DemoState;
      if (saved?.seededFor === today && Array.isArray(saved.tasks)) {
        state = saved;
        emit();
        return;
      }
    }
  } catch {
    // Unreadable snapshot — fall through to a fresh seed.
  }
  // No snapshot, or one seeded for another day: start over from today.
  state = freshState(today);
  persist();
  emit();
}

export function getDemoState(): DemoState {
  return state;
}

export function subscribeDemoStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replace the state. Every mutation in `api.ts` funnels through here. */
export function setDemoState(next: Partial<DemoState>): void {
  state = { ...state, ...next };
  persist();
  emit();
}

/** Throw the sandbox away and deal a fresh hand. */
export function resetDemoStore(): void {
  state = freshState();
  persist();
  // Whatever a held row was animating towards no longer exists, so the hold is
  // abandoned rather than waited out — a reset the visitor asked for must not
  // sit invisible behind someone else's exit timer.
  holds = 0;
  flush();
}
