"use client";

/**
 * How a list names one of its sections.
 *
 * The label was `text-xs font-semibold uppercase tracking-wider` in the group's
 * own colour, which failed at its one job: at 12px, grey, in caps it was
 * quieter than the 14px near-black rows underneath, so the eye read the rows
 * and skipped the thing naming them. Sentence case at 13px in the body colour
 * is louder than the rows without being bigger.
 *
 * The group's colour moved to the dot beside the label rather than being
 * dropped. A dot is the right channel for a category; tinting the words too
 * spent the same signal twice, and that is what forced the text so light.
 *
 * Four call sites share this — the grouped list, Today's sections, Upcoming's
 * day columns and the overdue section — so a section cannot be named one way on
 * one screen and another way on the next.
 */
export function sectionHeaderClass(
  compact: boolean,
  /**
   * Replaces the default colour — it does not sit beside it. Two `text-*`
   * utilities on one element have equal specificity, so which one wins is
   * decided by their order in Tailwind's generated stylesheet rather than by
   * the order they appear in the class string. Passing both is a coin flip.
   */
  colorClass = "text-neutral-700 dark:text-neutral-300"
): string {
  return [
    "flex w-full items-center gap-2 text-[13px] font-semibold",
    colorClass,
    compact ? "py-1" : "py-1.5",
  ].join(" ");
}

/**
 * The count beside a section's name.
 *
 * A pill rather than "(6)", so it reads as a quantity attached to the label
 * rather than as part of the sentence. `tabular-nums` keeps a "12" sitting
 * where a "6" did.
 */
export function SectionCount({ value }: { value: number }) {
  // neutral-600 in light rather than the neutral-500 the muted text uses:
  // 500 on a neutral-100 pill measures 4.35:1, which is under the bar for 11px
  // text. Dark keeps 400 on neutral-800, which measures 6:1 already.
  return (
    <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      {value}
    </span>
  );
}

/** The coloured dot that carries a group's identity, when it has one. */
export function SectionDot({ color }: { color: string }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

/** The disclosure caret on a collapsible section. */
export function SectionCaret({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`h-3 w-3 shrink-0 text-neutral-400 transition-transform motion-reduce:transition-none ${
        collapsed ? "" : "rotate-90"
      }`}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The classes that pin a section header to the top of the scroll.
 *
 * **The opaque background is the part that matters.** Without one, rows scroll
 * through the header instead of under it and the two sets of words overlap for
 * the length of the scroll. A static screenshot cannot show that; it is obvious
 * the moment anyone scrolls. Translucent plus `backdrop-blur` rather than a
 * solid fill, so the list still reads as one surface.
 *
 * `top` comes from `--dd-stick-top`, applied by `.dd-section-sticky` in
 * globals.css. StickyPageBar raises that variable for the subtree it wraps, so
 * a header pins under the page bar on a view that has one and under the app bar
 * on a view that does not, with no per-call-site number to keep in step.
 *
 * Each header sits inside its own `<section>`, which is the containment this
 * wants: a header pins while its own rows are on screen, then is pushed out by
 * the next section's header.
 */
export const STICKY_SECTION_HEADER =
  "dd-section-sticky sticky z-10 bg-white/90 backdrop-blur dark:bg-neutral-950/90";
