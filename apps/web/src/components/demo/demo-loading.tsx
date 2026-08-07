"use client";

/**
 * What a demo screen shows for the one tick between the server's HTML and the
 * sandbox being adopted on the client. See `useDemoData().ready` for why the
 * data can't simply be rendered server-side.
 */
export function DemoLoading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="mx-auto max-w-3xl animate-pulse" aria-hidden>
      <div className="mb-6 h-8 w-40 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="mb-4 h-11 rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      <div className="space-y-1">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5"
          >
            <div className="h-5 w-5 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-800" />
            <div
              className="h-4 rounded bg-neutral-200 dark:bg-neutral-800"
              style={{ width: `${45 + ((i * 13) % 40)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
