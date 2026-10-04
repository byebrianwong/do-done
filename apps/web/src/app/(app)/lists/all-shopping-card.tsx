import Link from "next/link";
import { ALL_SHOPPING_ID, ALL_SHOPPING_NAME, listSubline } from "@do-done/shared";

/**
 * The "All shopping" card at the head of the Lists index, real and demo alike.
 *
 * Above the lists rather than among them: it is not editable, not reorderable
 * and not deletable, and its count is the sum of the shopping lists below it.
 * The caller renders it only from two shopping lists (`offersAllShopping`);
 * with one it would be that list again under a second name.
 */
export function AllShoppingCard({
  base,
  counts,
}: {
  /** "" or "/demo", so the sandbox's link stays inside the sandbox. */
  base: string;
  counts: { open: number; got: number };
}) {
  return (
    <Link
      href={`${base}/lists/${ALL_SHOPPING_ID}`}
      className="group mb-3 block rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 transition-all hover:border-indigo-300 hover:shadow-sm dark:border-indigo-900/60 dark:bg-indigo-950/20 dark:hover:border-indigo-800"
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white"
        >
          <svg
            className="h-3.5 w-3.5"
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
        <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {ALL_SHOPPING_NAME}
        </h2>
      </div>
      <p className="mt-3 text-xs text-neutral-500">
        Every shopping list in one place · {listSubline(counts)}
      </p>
    </Link>
  );
}
