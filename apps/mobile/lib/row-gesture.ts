/**
 * What a press on a task row means.
 *
 * A row can be asked to do three things and has one body to ask with.
 * Reordering is the one that *must* be a hold: `DraggableFlatList` needs the
 * finger still down when `drag()` is called, so it cannot be a tap. That is why
 * the row used to carry a grab handle — multi-select owned the hold, so
 * dragging had to be given somewhere else to live, and that somewhere was ~36px
 * of every row on every screen, spent permanently on the rarer of the two
 * actions.
 *
 * So the hold goes to the drag, matching the projects list, which has long
 * pressed to reorder since it was written. Selection is armed from the list's
 * ⋯ menu instead — an explicit mode for an occasional job, rather than a
 * gesture the finger can fall into while trying to move a task.
 *
 * Once selection is armed the row is a target and nothing else: a tap picks it
 * instead of opening the editor, and the hold does nothing at all. Dragging
 * rows around while choosing them is ambiguous — the drop would rewrite the
 * task you were in the middle of selecting — which is the same reason the swipe
 * panels are disabled in that mode.
 */

/**
 * How long the finger has to stay down before a row starts moving.
 *
 * Longer than the 150ms the grab handle used, because the target is now the
 * whole row — which is also the surface the list is scrolled with. A finger
 * that settles for a moment before flicking must not carry a task away with it.
 * The row's own press already held for 350ms without misfiring during a scroll,
 * so this sits inside proven territory while feeling like a pickup rather than
 * a wait. (RN's `delayLongPress` default is 500, tuned for menus, not for this.)
 */
export const ROW_DRAG_HOLD_MS = 300;

export type RowTapAction = 'toggle-selection' | 'open';
export type RowLongPressAction = 'drag' | 'none';

export function rowTapAction({ selecting }: { selecting: boolean }): RowTapAction {
  return selecting ? 'toggle-selection' : 'open';
}

export function rowLongPressAction({
  selecting,
  draggable,
}: {
  /** Selection mode is armed — every row is a target. */
  selecting: boolean;
  /** This list can reorder, i.e. the row was handed a `drag` callback. */
  draggable: boolean;
}): RowLongPressAction {
  if (selecting) return 'none';
  return draggable ? 'drag' : 'none';
}
