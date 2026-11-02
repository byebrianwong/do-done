import { describe, expect, it, vi } from 'vitest';

// The hook needs React Navigation, which is not loadable in node. Only the
// pure walk is under test here.
vi.mock('@react-navigation/native', () => ({}));

const { isRouteVisible } = await import('./screen-activity');

/** Root stack: the tabs, plus whatever is pushed over them. */
function root(tabIndex: number, pushed: { key: string; name: string }[] = []) {
  return {
    index: pushed.length,
    routes: [
      {
        key: 'tabs',
        name: '(tabs)',
        state: {
          index: tabIndex,
          routes: [
            { key: 'agenda', name: 'index' },
            { key: 'tasks', name: 'tasks' },
            {
              key: 'lists',
              name: 'lists',
              state: {
                index: 1,
                routes: [
                  { key: 'lists-index', name: 'index' },
                  { key: 'groceries', name: '[id]' },
                ],
              },
            },
          ],
        },
      },
      ...pushed,
    ],
  };
}

describe('isRouteVisible', () => {
  it('is true for the focused tab', () => {
    expect(isRouteVisible(root(0), 'agenda')).toBe(true);
  });

  it('is false for a tab that is not selected', () => {
    // The case this exists for: All stays mounted after a visit, and a tick on
    // Today used to refetch and re-render it.
    expect(isRouteVisible(root(0), 'tasks')).toBe(false);
  });

  it('follows a stack inside a tab to its top screen', () => {
    expect(isRouteVisible(root(2), 'groceries')).toBe(true);
    expect(isRouteVisible(root(2), 'lists-index')).toBe(false);
  });

  it('keeps the list under the quick-add composer on view', () => {
    // The composer invalidates before closing so the new task is in the list
    // as the backdrop clears. That only works if the list under it is still
    // subscribed while the composer is up.
    const state = root(0, [{ key: 'qa', name: 'quick-add' }]);
    expect(isRouteVisible(state, 'agenda')).toBe(true);
    expect(isRouteVisible(state, 'tasks')).toBe(false);
  });

  it('keeps the list under a deep-linked task editor on view', () => {
    const state = root(2, [{ key: 't', name: 'task/[id]' }]);
    expect(isRouteVisible(state, 'groceries')).toBe(true);
  });

  it('hides everything under an ordinary pushed screen', () => {
    const state = root(0, [{ key: 's', name: 'settings' }]);
    expect(isRouteVisible(state, 'agenda')).toBe(false);
    expect(isRouteVisible(state, 's')).toBe(true);
  });

  it('is false with no state at all', () => {
    expect(isRouteVisible(undefined, 'agenda')).toBe(false);
  });
});
