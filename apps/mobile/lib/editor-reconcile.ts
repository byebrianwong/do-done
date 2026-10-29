/**
 * When the task editor refreshes the lists behind it.
 *
 * Each autosave patches the saved row into the cache (`patch`). The full
 * refetch (`invalidate`) runs once, when the editor closes. Refetching on every
 * save meant that pausing between words refetched every list under the sheet,
 * on the JS thread the title field was using.
 *
 * Closing does not wait for the last save. The sheet unmounts, the autosave hook
 * flushes the queued edit on its way out, and that write lands afterwards. A
 * refetch sent at close would race it and could read the row from before it. So:
 *
 * - Closed with nothing saved and nothing queued: no refetch. Nothing changed.
 * - Closed with saves landed and nothing queued: one refetch, now.
 * - Closed with a save queued or in flight: wait for it, and refetch when it
 *   lands. Every save that lands after close refetches, so a second flushed
 *   write is covered too. If no save lands within `fallbackMs` (the flush
 *   failed, or the app went offline), refetch anyway: an earlier save may
 *   have moved the row to another list, and status sync may have changed
 *   fields the editor never saw.
 *
 * Pure, with its effects injected, so the node suite covers it.
 */

export interface EditorReconcilerDeps<Row> {
  /** Write a saved row into the cached lists. */
  patch: (row: Row) => void;
  /** Refetch every task list. */
  invalidate: () => void;
  /** Injected so tests can drive time. Defaults to setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** How long to wait for a save queued at close. */
  fallbackMs?: number;
}

export interface EditorReconciler<Row> {
  /** An autosave landed. `row` is the editor's copy of the task. */
  saved: (row: Row) => void;
  /** The editor body unmounted. `savePending` is true when a save is queued or in flight. */
  closed: (savePending: boolean) => void;
}

export const EDITOR_RECONCILE_FALLBACK_MS = 4000;

export function createEditorReconciler<Row>({
  patch,
  invalidate,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  fallbackMs = EDITOR_RECONCILE_FALLBACK_MS,
}: EditorReconcilerDeps<Row>): EditorReconciler<Row> {
  let anySaved = false;
  let isClosed = false;
  let fallback: unknown = null;

  const cancelFallback = () => {
    if (fallback !== null) {
      clearTimer(fallback);
      fallback = null;
    }
  };

  return {
    saved(row) {
      anySaved = true;
      patch(row);
      if (isClosed) {
        cancelFallback();
        invalidate();
      }
    },
    closed(savePending) {
      if (isClosed) return;
      isClosed = true;
      if (savePending) {
        fallback = setTimer(() => {
          fallback = null;
          invalidate();
        }, fallbackMs);
        return;
      }
      if (anySaved) invalidate();
    },
  };
}
