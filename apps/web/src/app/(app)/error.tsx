"use client";

import { useEffect } from "react";

/**
 * What a failed read renders instead of the page.
 *
 * The copy leads with "nothing is lost" on purpose. The failure this boundary
 * exists for looked exactly like data loss from the outside — every list
 * empty, every task link 404ing — because the pages discarded `error` and
 * rendered their own empty states. Naming the difference is the whole job:
 * this is the app failing to reach the server, not the account being empty.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  /**
   * Next 16's retry: re-fetches and re-renders the boundary's children. Not
   * `reset`, which only clears the error state and re-renders what it already
   * has — no use when the failure *was* the fetch.
   */
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // The message is replaced by a digest before it reaches the client; the
    // real one is in the server log next to this digest.
    console.error("Failed to load page data", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-xl border border-neutral-200 bg-white p-8 dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Couldn&rsquo;t load your tasks
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Nothing is lost — this is a problem reaching the server, not a problem
          with your data. Your tasks are still there.
        </p>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-lg bg-indigo-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600 active:bg-indigo-700"
          >
            Try again
          </button>
          <a
            href="https://status.supabase.com"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-700 hover:underline dark:hover:text-neutral-300"
          >
            Check service status
          </a>
        </div>

        {error.digest ? (
          <p className="mt-6 font-mono text-xs text-neutral-400">
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
