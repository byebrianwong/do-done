/**
 * Which list a List widget is pinned to.
 *
 * Every failure here is silent on a home screen. A widget that forgets its pin
 * looks like a widget that was never configured; a widget that keeps a pin to a
 * deleted list draws an empty card that no amount of tapping recovers; and a
 * stale pin on a reused widget id opens someone's Hardware list where they put
 * Groceries. None of the three raises anything, which is why the rule is a pure
 * function and lives here.
 */
import { describe, it, expect, vi } from 'vitest';

// The module's decision half is pure; its storage half is not, and AsyncStorage
// is a native module with nothing behind it here.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

const { targetDecision, targetKey, widgetIdFromKey } = await import(
  './widget-target'
);

describe('what a List widget draws', () => {
  it('shows the pinned list', () => {
    expect(
      targetDecision({ stored: 'groceries', known: ['groceries', 'work'] })
    ).toEqual({ action: 'show', id: 'groceries' });
  });

  it('asks again when the pinned list is gone', () => {
    // Deleted on the laptop. The widget has no back button, so stranding it on
    // a list that no longer exists is the one unrecoverable state.
    expect(targetDecision({ stored: 'groceries', known: ['work'] })).toEqual({
      action: 'pick',
    });
  });

  it('asks when nothing is pinned', () => {
    expect(
      targetDecision({ stored: null, known: ['groceries', 'work'] })
    ).toEqual({ action: 'pick' });
  });

  it('picks the only candidate rather than asking a question with one answer', () => {
    expect(targetDecision({ stored: null, known: ['groceries'] })).toEqual({
      action: 'show',
      id: 'groceries',
    });
  });

  it('asks when there is nothing to pick, so the card can say so', () => {
    expect(targetDecision({ stored: null, known: [] })).toEqual({
      action: 'pick',
    });
  });
});

describe('the storage key', () => {
  it('round-trips a widget id', () => {
    expect(widgetIdFromKey(targetKey(42))).toBe(42);
  });

  it('ignores a key that is not ours', () => {
    // `forgetTarget` and the sweep both filter on this. Treating another
    // feature's AsyncStorage key as a widget id would delete it.
    expect(widgetIdFromKey('nav:lists:last')).toBeNull();
    expect(widgetIdFromKey('widget:list-target:not-a-number')).toBeNull();
  });
});
