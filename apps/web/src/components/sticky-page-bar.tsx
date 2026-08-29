"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A list's title, pinned.
 *
 * The page title scrolled away with everything else, so one screen into a long
 * list nothing said which list it was — and the Display menu, which sits beside
 * the title, went with it. Both are now in a bar that stays.
 *
 * **The big title still leads.** Pinning it at full size would spend ~56px of
 * every screen on a word the sidebar already highlights, so the heading stays
 * in flow and hands off to a compact 48px bar as it leaves. That is iOS's
 * large-title behaviour, and close to what the phone already does here: its
 * title bar is a sibling of the list and never scrolls.
 *
 * **The handoff is an IntersectionObserver on a sentinel, not a scroll
 * handler.** A scroll listener works on every frame to answer a question that
 * changes twice. The observer answers it when it changes, and it reports
 * correctly however the scroll happened — wheel, keyboard, anchor jump, or
 * `scrollIntoView` after a route change.
 *
 * The bar raises `--dd-stick-top` for everything it wraps (`.dd-stick-scope`),
 * so group headers inside pin beneath it rather than under it. Both offsets are
 * classes in globals.css, so the two numbers that have to agree are written
 * once rather than at each element that pins.
 */
export function StickyPageBar({
  title,
  /** Right-hand slot — in practice the Display menu. Always visible. */
  actions,
  /** Rendered under the big title, in flow. Scrolls away with it. */
  subtitle,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    let observer: IntersectionObserver | null = null;

    // The sentinel counts as gone once it is under the bar, not once it is off
    // the top of the viewport, so the observer needs the pinned height as its
    // top margin. `rootMargin` takes only px and %, never `calc()` or a
    // variable, so the tokens are resolved here — and re-resolved on resize,
    // since crossing the md breakpoint zeroes the app bar.
    const connect = () => {
      observer?.disconnect();
      const root = getComputedStyle(document.documentElement);
      const px = (name: string) => parseFloat(root.getPropertyValue(name)) || 0;
      // The tokens are in rem; the observer wants px.
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const offset = (px("--dd-appbar-h") + px("--dd-pagebar-h")) * rem;
      observer = new IntersectionObserver(
        ([entry]) => setStuck(!entry.isIntersecting),
        { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 }
      );
      observer.observe(node);
    };

    connect();
    window.addEventListener("resize", connect);
    return () => {
      window.removeEventListener("resize", connect);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="dd-stick-scope">
      <div
        // `-mx-*` cancels the shell's page padding so the bar's background
        // reaches the full width of the column. Without it a row scrolling past
        // shows through the gutters either side of the bar.
        className={`dd-pagebar sticky z-20 -mx-4 flex h-12 items-center gap-3 px-4 backdrop-blur transition-colors sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 ${
          stuck
            ? "border-b border-neutral-200 bg-white/85 dark:border-neutral-800 dark:bg-neutral-950/85"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        {/* The title is in the bar from the start and merely invisible, so the
            handoff is a fade rather than a mount — and so the bar's height
            never depends on whether it has landed yet. */}
        {title ? (
          <span
            aria-hidden={!stuck}
            className={`truncate text-base font-semibold text-neutral-900 transition-opacity duration-200 motion-reduce:transition-none dark:text-neutral-100 ${
              stuck ? "opacity-100" : "opacity-0"
            }`}
          >
            {title}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      </div>

      {title ? (
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {title}
        </h1>
      ) : null}
      {subtitle}
      {/* Where the big title ends is where the bar takes over. Zero-height, so
          it costs no layout. */}
      <div ref={sentinel} aria-hidden className="h-px" />

      {children}
    </div>
  );
}
