"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveals its children as they scroll into view.
 *
 * An IntersectionObserver rather than a scroll listener: the browser does the
 * work off the main thread and tells us once, and the class it toggles is what
 * the CSS transition in `globals.css` hangs off — so the motion itself never
 * touches JS. Reveals are one-way; a section that has been read doesn't
 * un-reveal when it leaves the screen.
 */
export function Reveal({
  children,
  delayMs = 0,
  className = "",
}: {
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No observer (old browser, jsdom) means no reveal — show the content
    // rather than leaving the page permanently blank.
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      // Fire a little before the section's top edge arrives, so the motion is
      // finishing as the reader gets there rather than starting.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`dd-reveal ${shown ? "dd-in" : ""} ${className}`}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}
