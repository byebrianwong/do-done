"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Toggle pill that flips a URL search param to hide/show inbox tasks in
 * a list view. Drives a server-component filter via `?inbox=hide`.
 */
export function InboxFilterToggle({ count }: { count: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const hidden = params.get("inbox") === "hide";

  const toggle = () => {
    const next = new URLSearchParams(params.toString());
    if (hidden) next.delete("inbox");
    else next.set("inbox", "hide");
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      title={
        hidden
          ? "Show inbox tasks in this view"
          : "Hide inbox tasks from this view"
      }
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        hidden
          ? "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900"
          : "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          hidden ? "bg-neutral-400" : "bg-indigo-500"
        }`}
        aria-hidden
      />
      {hidden ? "Inbox hidden" : `Inbox · ${count}`}
    </button>
  );
}
