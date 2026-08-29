import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      store.delete(k);
    }),
  },
}));

import {
  hydrateViewModes,
  resetViewModes,
  setAgendaMode,
  setTasksMode,
  toggleAgendaMode,
  toggleTasksMode,
} from './view-mode';

// The state itself is only readable through the hook, and there is no renderer
// here — so these assert on what reaches storage, which is the half that has
// to survive a relaunch anyway.
const AGENDA = 'nav:mode:agenda';
const TASKS = 'nav:mode:tasks';

describe('view modes', () => {
  beforeEach(() => {
    store.clear();
    resetViewModes();
  });

  it('starts on the half people live in, and writes nothing to say so', async () => {
    await hydrateViewModes();
    expect(store.get(AGENDA)).toBeUndefined();
    expect(store.get(TASKS)).toBeUndefined();
  });

  it('persists what you switch to', () => {
    setAgendaMode('upcoming');
    setTasksMode('inbox');
    expect(store.get(AGENDA)).toBe('upcoming');
    expect(store.get(TASKS)).toBe('inbox');
  });

  it('toggles between the two halves', () => {
    toggleAgendaMode();
    expect(store.get(AGENDA)).toBe('upcoming');
    toggleAgendaMode();
    expect(store.get(AGENDA)).toBe('today');
    toggleTasksMode();
    expect(store.get(TASKS)).toBe('inbox');
  });

  it('restores what the app was last left on', async () => {
    store.set(AGENDA, 'upcoming');
    await hydrateViewModes();
    // If the restore landed, toggling from Upcoming writes Today.
    toggleAgendaMode();
    expect(store.get(AGENDA)).toBe('today');
  });

  it('lets a deep link beat a restore that lands after it', async () => {
    // `dodone://upcoming` opens while the stored modes are still being read.
    // The link is the newer instruction; a restore arriving late must not
    // quietly put the tab back on Today.
    store.set(AGENDA, 'today');
    const restoring = hydrateViewModes();
    setAgendaMode('upcoming');
    await restoring;
    toggleAgendaMode();
    expect(store.get(AGENDA)).toBe('today');
  });

  it('does not write when the mode is already what you asked for', () => {
    setAgendaMode('upcoming');
    store.delete(AGENDA);
    setAgendaMode('upcoming');
    expect(store.get(AGENDA)).toBeUndefined();
  });
});
