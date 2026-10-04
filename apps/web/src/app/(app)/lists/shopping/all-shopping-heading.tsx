import type { Project } from "@do-done/shared";
import { ALL_SHOPPING_NAME } from "@do-done/shared";

/**
 * The heading over "All shopping", shared by the real page and the demo's.
 *
 * The ring is the accent rather than a list's colour, because this view is
 * every shopping list and no one list's colour would be right. The line under
 * the title names the lists it combines, so a list that is missing (switched
 * to a checklist, or never a shopping list) is visibly missing.
 */
export function AllShoppingHeading({ lists }: { lists: Project[] }) {
  const names = lists.map((l) => l.name);
  const joined =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <div className="mb-5 flex items-center gap-3">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="20" r="1.5" />
          <circle cx="18" cy="20" r="1.5" />
          <path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h8.8a1.5 1.5 0 0 0 1.5-1.2L21 8H6" />
        </svg>
      </span>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          {ALL_SHOPPING_NAME}
        </h1>
        {joined && (
          <p className="truncate text-xs text-neutral-500">{joined}</p>
        )}
      </div>
    </div>
  );
}
