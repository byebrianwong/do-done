/**
 * Which panel a `ReanimatedSwipeable` just opened.
 *
 * **`ReanimatedSwipeable` reports the direction of the gesture, not the side
 * whose panel opened** — the opposite of the classic `Swipeable` it replaces,
 * and the opposite of what the prop name reads as. From the library's own
 * `dispatchImmediateEvents` (v2.31):
 *
 * ```ts
 * runOnJS(onSwipeableWillOpen)(
 *   toValue > 0 ? SwipeDirection.RIGHT : SwipeDirection.LEFT
 * );
 * ```
 *
 * `toValue > 0` is the row translated to the *right*, which is the row's
 * **left** actions showing. So `'right'` means the left panel opened, and
 * `'left'` means the right panel did.
 *
 * Reading it the other way round is silent and total: every swipe fires the
 * wrong action and the intended one never fires at all. Hence a named function
 * with a test rather than a string comparison inline.
 */
export type SwipeOpenDirection = 'left' | 'right';

/**
 * `'complete'` — the row's leading (left) panel, revealed by swiping right.
 * `'actions'` — the row's trailing (right) panel, revealed by swiping left.
 */
export type SwipePanel = 'complete' | 'actions';

export function panelForSwipe(direction: SwipeOpenDirection): SwipePanel {
  return direction === 'right' ? 'complete' : 'actions';
}
