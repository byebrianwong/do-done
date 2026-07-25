import { Fragment } from "react";
import { linkifyText } from "@do-done/shared";

export interface LinkifiedTextProps {
  /** The raw string (task title, notes, …) to render with URLs as links. */
  text: string;
  /** Extra classes for the anchor elements — e.g. to tune the accent per surface. */
  linkClassName?: string;
}

/**
 * Renders a string as inline content, turning any URLs it contains into
 * clickable links. Task titles are entered as free text ("Buy dog muzzle
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
            // Rows are themselves clickable (they open the editor); stop the
            // click here so following the link never also opens the modal.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
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
