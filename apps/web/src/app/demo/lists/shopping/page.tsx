"use client";

import Link from "next/link";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";
import { shoppingLists } from "@do-done/shared";
import { ListView } from "@/app/(app)/lists/[id]/list-view";
import { AllShoppingHeading } from "@/app/(app)/lists/shopping/all-shopping-heading";

/**
 * "All shopping" in the sandbox. The real component against the sandbox's
 * API, the same trade the demo's single-list page makes.
 */
export default function DemoAllShoppingPage() {
  const { items, projects, ready } = useDemoData();
  if (!ready) return <DemoLoading rows={6} />;

  const shopLists = shoppingLists(projects);
  const ids = new Set(shopLists.map((l) => l.id));
  const mine = items.filter((t) => t.project_id !== null && ids.has(t.project_id));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs">
        <Link
          href="/demo/lists"
          className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          ← Lists
        </Link>
      </div>
      <AllShoppingHeading lists={shopLists} />
      <ListView list={null} shoppingLists={shopLists} initialItems={mine} />
    </div>
  );
}
