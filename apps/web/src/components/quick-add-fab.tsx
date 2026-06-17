"use client";

import { openQuickAdd } from "@/lib/quick-add-events";

/**
 * Floating "new task" button, pinned bottom-right over the content. Dispatches
 * the global quick-add event. Offset left of the pet panel on xl+ (where the
 * panel occupies a fixed 320px column) so the two never overlap; hidden while
 * the mobile nav drawer is open.
 */
export function QuickAddFab({
  hasPetPanel,
  hidden,
}: {
  hasPetPanel: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={() => openQuickAdd()}
      aria-label="New task"
      title="New task (q)"
      className={`fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 transition-colors hover:bg-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 ${
        hasPetPanel ? "xl:right-[336px]" : ""
      }`}
    >
      <svg
        className="h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
      </svg>
    </button>
  );
}
