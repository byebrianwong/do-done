/**
 * How far to scroll so a focused field is on screen once the keyboard is up.
 *
 * This is the fallback, not the main mechanism. On Android, a ScrollView that
 * shrinks keeps its focused child in view by itself (`ScrollView.onSizeChanged`),
 * and the editor shrinks its body by the keyboard's height every frame. On iOS
 * `automaticallyAdjustKeyboardInsets` scrolls the field in during the
 * keyboard's own animation. This runs once the keyboard has landed and does
 * nothing when either of those already worked, which is the expected case.
 *
 * All values are window coordinates in dp, as `measureInWindow` reports them.
 * A positive result scrolls the content up (the field moves up the screen).
 */
export interface RevealInput {
  fieldTop: number;
  fieldBottom: number;
  /** The visible part of the scroll view. */
  viewTop: number;
  viewBottom: number;
  /** Space to leave between the field and the edge it is brought to. */
  margin: number;
}

export function revealScrollDelta({
  fieldTop,
  fieldBottom,
  viewTop,
  viewBottom,
  margin,
}: RevealInput): number {
  const top = viewTop + margin;
  const bottom = viewBottom - margin;
  if (!(bottom > top)) return 0;

  // A field taller than the viewport (a long note) cannot be shown whole, and
  // the part that matters is the line with the cursor, which only the native
  // text view knows. So leave it alone unless none of it is on screen at all,
  // and then bring its top edge in.
  if (fieldBottom - fieldTop > bottom - top) {
    if (fieldTop >= viewBottom) return fieldTop - top;
    if (fieldBottom <= viewTop) return fieldTop - top;
    return 0;
  }

  if (fieldBottom > bottom) return fieldBottom - bottom;
  if (fieldTop < top) return fieldTop - top;
  return 0;
}
