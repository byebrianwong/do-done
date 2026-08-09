"use client";

import { useCallback, useRef, type MouseEvent } from "react";

/**
 * Backdrop-click dismissal that survives a text selection dragged out of the
 * dialog.
 *
 * `onClick={close}` on the overlay is not the same rule as "the user clicked
 * the backdrop". A `click` fires on the nearest common ancestor of where the
 * button went *down* and where it came *up*, so pressing inside the dialog —
 * selecting a long title, say — and releasing over the backdrop dispatches the
 * click on the overlay itself. The dialog's own `stopPropagation` never sees
 * it, and neither does an `e.target === e.currentTarget` check: the overlay
 * genuinely *is* the target. The editor shut mid-selection, taking the title
 * the user was about to retype with it.
 *
 * So the press and the release both have to land on the backdrop. `mousedown`
 * arms, a `mouseup` anywhere inside the dialog disarms, and only an armed
 * click dismisses — which also fixes the mirror case of starting on the
 * backdrop and releasing inside.
 *
 * Spread onto the overlay element; leave the dialog's `stopPropagation` alone,
 * since these overlays render inside a task row's React subtree and that is
 * what keeps a click off the row underneath.
 */
export function useBackdropDismiss<T extends HTMLElement = HTMLElement>(
  onDismiss: () => void
): {
  onMouseDown: (e: MouseEvent<T>) => void;
  onMouseUp: (e: MouseEvent<T>) => void;
  onClick: (e: MouseEvent<T>) => void;
} {
  const armed = useRef(false);

  const onMouseDown = useCallback((e: MouseEvent<T>) => {
    armed.current = e.target === e.currentTarget;
  }, []);

  const onMouseUp = useCallback((e: MouseEvent<T>) => {
    if (e.target !== e.currentTarget) armed.current = false;
  }, []);

  const onClick = useCallback(
    (e: MouseEvent<T>) => {
      const wasArmed = armed.current;
      armed.current = false;
      if (!wasArmed) return;
      if (e.target !== e.currentTarget) return;
      onDismiss();
    },
    [onDismiss]
  );

  return { onMouseDown, onMouseUp, onClick };
}
