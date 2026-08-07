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

function emit() {
  for (const l of listeners) l();
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
  emit();
}
