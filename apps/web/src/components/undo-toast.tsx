"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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

const TOAST_TTL_MS = 6000;

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
      }, TOAST_TTL_MS);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <UndoToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            <span className="text-sm text-neutral-700 dark:text-neutral-200">
              {toast.message}
            </span>
            {toast.undo ? (
              <button
                type="button"
                onClick={async () => {
                  const fn = toast.undo;
                  dismiss();
                  await fn?.();
                }}
                className="rounded px-2 py-1 text-sm font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
              >
                Undo
              </button>
            ) : null}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
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
