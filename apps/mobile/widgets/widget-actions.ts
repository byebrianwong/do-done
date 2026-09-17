/**
 * The click actions a widget emits, named once.
 *
 * `clickAction` is a bare string on one side and a `switch` on the other, with
 * the launcher in between and nothing type-checking the pair. A rename that
 * reaches one side fails the way everything on a home screen fails: the tap
 * does nothing, there is no error, and the widget looks merely unresponsive.
 *
 * `OPEN_URI` and `OPEN_APP` are not here — the library handles those itself and
 * they never reach the task handler.
 */

/** Tick the task off. `{ taskId: string }`. */
export const COMPLETE_TASK = 'COMPLETE_TASK';

/** Pin this widget to a list or project. `{ projectId: string }`. */
export const SET_LIST_TARGET = 'SET_LIST_TARGET';

/** Unpin it, so the picker comes back. No data. */
export const CLEAR_LIST_TARGET = 'CLEAR_LIST_TARGET';
