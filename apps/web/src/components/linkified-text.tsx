import { Fragment } from "react";
import { linkifyText } from "@do-done/shared";

/**
 * Class for a draggable element that contains linkified text, applied while
 * that element is being dragged.
 *
 * Links inside a draggable row let the drag start (they don't stop mousedown),
 * so a drag can begin on the link itself. dnd-kit stops the trailing click
 * from propagating, but `stopPropagation` is not `preventDefault` — the anchor
 * would still navigate when a drag happens to end back over it. Taking the
 * links out of hit-testing mid-drag makes the row, not the anchor, the click
 * target, so the drop doesn't also open a browser tab.
 */
export const NO_LINK_NAV_WHILE_DRAGGING = "[&_a]:pointer-events-none";

export interface LinkifiedTextProps {
  /** The raw string (task title, notes, …) to render with URLs as links. */
  text: string;
  /** Extra classes for the anchor elements — e.g. to tune the accent per surface. */
  linkClassName?: string;
}

/**
 * Renders a string as inline content, turning any URLs it contains into
 * clickable links. Task titles are entered as free text ("Buy dog food
 * https://…"), and a bare URL in that text should be tappable rather than dead
 * characters.
 *
 * Emits plain text and `<a>` nodes only — no wrapper element — so it slots
 * inside whatever the caller already renders (a `line-clamp`ped span, a
 * heading) without disturbing its layout or text styling. Link detection lives
 * in `@do-done/shared` so web and mobile linkify identically.
 */
export function LinkifiedText({ text, linkClassName }: LinkifiedTextProps) {
  const segments = linkifyText(text);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <Fragment key={i}>{seg.value}</Fragment>;
        return (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            // A native link drag would hijack the gesture from dnd-kit before
            // its 4px threshold and drop a URL somewhere instead of moving the
            // task. The row's own drag still works — mousedown is deliberately
            // left to bubble (see NO_LINK_NAV_WHILE_DRAGGING).
            draggable={false}
            // Rows are themselves clickable (they open the editor); stop the
            // click here so following the link never also opens the modal.
            onClick={(e) => e.stopPropagation()}
            className={
              linkClassName ??
              "font-medium text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:decoration-indigo-500 dark:text-indigo-400 dark:decoration-indigo-500/60 dark:hover:decoration-indigo-400"
            }
          >
            {seg.value}
          </a>
        );
      })}
    </>
  );
}
