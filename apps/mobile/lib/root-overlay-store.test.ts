import { describe, expect, it, vi } from 'vitest';
import { createOverlayStore } from './root-overlay-store';

describe('createOverlayStore', () => {
  it('draws entries in the order they were first registered', () => {
    const store = createOverlayStore<string>();
    store.set(1, 'editor');
    store.set(2, 'location sheet');
    expect(store.entries().map(([, c]) => c)).toEqual([
      'editor',
      'location sheet',
    ]);
  });

  it('keeps an updated entry in its place, under anything opened over it', () => {
    const store = createOverlayStore<string>();
    store.set(1, 'editor v1');
    store.set(2, 'location sheet');
    store.set(1, 'editor v2');
    expect(store.entries()).toEqual([
      [1, 'editor v2'],
      [2, 'location sheet'],
    ]);
  });

  it('removes an entry, and a re-registered id goes back on top', () => {
    const store = createOverlayStore<string>();
    store.set(1, 'a');
    store.set(2, 'b');
    store.remove(1);
    expect(store.entries()).toEqual([[2, 'b']]);
    store.set(1, 'a');
    expect(store.entries()).toEqual([
      [2, 'b'],
      [1, 'a'],
    ]);
  });

  it('notifies on every change, and not for removing an unknown id', () => {
    const store = createOverlayStore<string>();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(1, 'a');
    store.set(1, 'b');
    store.remove(1);
    store.remove(1);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    store.set(2, 'c');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('hands out a new snapshot only when something changed', () => {
    const store = createOverlayStore<string>();
    const before = store.entries();
    expect(store.entries()).toBe(before);
    store.set(1, 'a');
    expect(store.entries()).not.toBe(before);
  });
});
