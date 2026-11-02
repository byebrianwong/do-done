/**
 * The bookkeeping behind `RootPortal` / `RootOverlayHost`
 * (components/RootOverlay.tsx), kept apart from React so the node suite can
 * check it.
 *
 * A portal registers what it wants drawn under an id. The host draws every
 * entry, in the order the entries were first registered, so a sheet opened
 * from inside another sheet is drawn on top of it. Updating an entry keeps its
 * place: an editor that re-renders while a picker is open over it must not
 * jump above the picker.
 */

export interface OverlayStore<T> {
  /** Add an entry, or replace its content in place if the id is known. */
  set(id: number, content: T): void;
  /** Drop an entry. Unknown ids are ignored. */
  remove(id: number): void;
  /** Every entry, oldest registration first. A new array on every change. */
  entries(): ReadonlyArray<readonly [number, T]>;
  /** Called after every change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export function createOverlayStore<T>(): OverlayStore<T> {
  // A Map iterates in insertion order, and `set` on an existing key keeps the
  // key where it was. That is exactly the ordering rule above.
  const map = new Map<number, T>();
  let snapshot: ReadonlyArray<readonly [number, T]> = [];
  const listeners = new Set<() => void>();

  const changed = () => {
    snapshot = Array.from(map.entries());
    for (const listener of listeners) listener();
  };

  return {
    set(id, content) {
      map.set(id, content);
      changed();
    },
    remove(id) {
      if (!map.delete(id)) return;
      changed();
    },
    entries: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
