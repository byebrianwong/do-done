"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { UNDO_TOAST_TTL_MS } from "@do-done/shared";

type Toast = {
  id: number;
  message: string;
  /**
   * Omit for a plain confirmation ("Link copied") — the Undo button is only
   * rendered when there is in fact something to undo.
   */
  undo?: () => void | Promise<void>;
};

type Ctx = {
  show: (toast: Omit<Toast, "id">) => void;
};

const UndoToastContext = createContext<Ctx | null>(null);

/**
 * True for a target where ⌘Z already means something.
 *
 * The shortcut is a convenience over the button, and it must never be the
 * reason a half-typed title loses its last word — so a field that has its own
 * undo stack keeps it.
 */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input, textarea, select, [contenteditable='true']");
}

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const show = useCallback<Ctx["show"]>(
    (t) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const id = ++idRef.current;
      setToast({ ...t, id });
      timerRef.current = setTimeout(() => {
        setToast((cur) => (cur?.id === id ? null : cur));
      }, UNDO_TOAST_TTL_MS);
    },
    []
  );

  const runUndo = useCallback(async () => {
    const fn = toast?.undo;
    if (!fn) return;
    dismiss();
    await fn();
  }, [toast, dismiss]);

  /**
   * ⌘Z / Ctrl-Z while the toast is up.
   *
   * The button is the affordance and this is the reflex: an undo you reach for
   * without moving the pointer is worth more in the seconds after a mistake
   * than any amount of styling on the button. Bound only while a toast with an
   * undo is actually on screen, so it can never swallow the key otherwise.
   */
  useEffect(() => {
    if (!toast?.undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "z" && e.key !== "Z") return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      // Redo is a different key press and not ours to intercept.
      if (e.shiftKey) return;
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      void runUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast, runUndo]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <UndoToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
          /* `polite`, and on a live region that exists only while the toast
             does — the message is the fallback for anyone who can't see the row
             leave, which now includes anyone who asked for reduced motion. */
          role="status"
          aria-live="polite"
        >
          {/* Dark on both themes, deliberately. The toast used to be a white
              card on a white page, which put the one control that can take a
              deletion back at the bottom of the visual hierarchy. It is the
              only element on screen that is temporary and irreversible-if-
              missed, so it is the only one that gets to sit above the page's
              palette entirely. */}
          <div
            key={toast.id}
            className="dd-toast pointer-events-auto flex max-w-full items-center gap-3 overflow-hidden rounded-xl bg-neutral-900 py-2.5 pl-4 pr-2.5 shadow-[0_12px_32px_rgba(17,24,39,0.28),0_2px_8px_rgba(17,24,39,0.16)] ring-1 ring-white/10 dark:bg-neutral-800"
          >
            <span className="truncate text-sm text-neutral-100">
              {toast.message}
            </span>
            {toast.undo ? (
              <button
                type="button"
                onClick={() => void runUndo()}
                className="relative shrink-0 overflow-hidden rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
              >
                <span className="flex items-center gap-1.5">
                  Undo
                  {/* The shortcut is advertised where it is used. A binding
                      nobody is told about is a binding nobody presses. */}
                  <kbd className="hidden font-sans text-[11px] font-medium text-indigo-100/80 sm:inline">
                    ⌘Z
                  </kbd>
                </span>
                {/* The window, drawn draining. The button is only useful while
                    it lasts, and a countdown is the difference between "there
                    is an Undo" and "there is an Undo *and you have time*" —
                    which is the whole reason the window was widened. Keyed on
                    the toast id so a second toast restarts the run rather than
                    inheriting the first one's remaining time. */}
                <span
                  key={toast.id}
                  aria-hidden
                  className="dd-undo-countdown absolute inset-x-0 bottom-0 h-[3px] origin-left bg-white/45"
                  style={{ animationDuration: `${UNDO_TOAST_TTL_MS}ms` }}
                />
              </button>
            ) : null}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="shrink-0 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </UndoToastContext.Provider>
  );
}

export function useUndoToast(): Ctx {
  const ctx = useContext(UndoToastContext);
  if (!ctx) {
    // Allow components rendered outside the provider (e.g. Storybook) to call
    // show() without crashing — fall back to a no-op.
    return { show: () => {} };
  }
  return ctx;
}
