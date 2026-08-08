"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The quick-add bar, typing itself out.
 *
 * DoDone's parser reads a whole task out of one line, and no static screenshot
 * conveys that — the point is the *moment* the sentence turns into fields. So
 * the phrase is typed a character at a time and each chip lands as the words
 * that produced it finish, which is what the real bar does as you type.
 *
 * A single `setTimeout` chain rather than a CSS `steps()` typewriter: the chips
 * have to fire at specific character offsets, and steps() has no idea where in
 * the string it is. It stops when the section scrolls away, so an unread tab
 * isn't animating a demo nobody is looking at.
 */

/**
 * Verified against `parseTaskInput` — every chip below is a field the parser
 * actually returns for this exact string. `/tomorrow` is what *schedules* a
 * task; a bare "tomorrow" sets a deadline instead, which is the distinction
 * the rest of the page is about, so the demo must not blur it.
 */
const PHRASE = "/tomorrow Email Priya the Q3 numbers ~30m #finance p1";

/** Each chip appears once typing passes `at` characters. */
const CHIPS: Array<{ at: number; label: string; className: string }> = [
  {
    at: 9,
    label: "📅 Scheduled tomorrow",
    className:
      "bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400",
  },
  {
    at: 41,
    label: "⏱ 30m",
    className:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  },
  {
    at: 50,
    label: "#finance",
    className:
      "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400",
  },
  {
    at: 53,
    label: "P1 · Urgent",
    className: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400",
  },
];

const TYPE_MS = 45;
const HOLD_MS = 2600;
const CLEAR_MS = 900;

export function QuickAddDemo() {
  const [typed, setTyped] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setVisible(!!entry?.isIntersecting),
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Reduced motion gets the finished sentence, not a typewriter.
    if (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setTyped(PHRASE.length);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      setTyped((n) => {
        if (n < PHRASE.length) {
          timer = setTimeout(step, TYPE_MS);
          return n + 1;
        }
        // Full phrase: hold it, wipe it, start again.
        timer = setTimeout(() => {
          setTyped(0);
          timer = setTimeout(step, CLEAR_MS);
        }, HOLD_MS);
        return n;
      });
    };
    timer = setTimeout(step, 400);
    return () => clearTimeout(timer);
  }, [visible]);

  const shown = CHIPS.filter((c) => typed >= c.at);
  const done = typed >= PHRASE.length;

  return (
    <div ref={hostRef}>
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3.5 py-3 dark:border-neutral-700">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-indigo-500" />
          <span className="min-w-0 flex-1 truncate text-left text-sm text-neutral-800 dark:text-neutral-100">
            {PHRASE.slice(0, typed)}
            <span className="dd-caret ml-px inline-block h-4 w-px translate-y-0.5 bg-indigo-500" />
          </span>
        </div>

        <div className="mt-3 flex min-h-[26px] flex-wrap items-center gap-1.5 px-1">
          {shown.length === 0 ? (
            <span className="text-[11px] text-neutral-400">
              Type it the way you’d say it.
            </span>
          ) : (
            shown.map((c) => (
              <span
                key={c.label}
                className={`dd-chip-in rounded-full px-2 py-0.5 text-[11px] font-medium ${c.className}`}
              >
                {c.label}
              </span>
            ))
          )}
          <span
            className={`ml-auto text-[11px] font-medium text-emerald-600 transition-opacity duration-300 dark:text-emerald-400 ${
              done ? "opacity-100" : "opacity-0"
            }`}
          >
            ✓ Added
          </span>
        </div>
      </div>
    </div>
  );
}
