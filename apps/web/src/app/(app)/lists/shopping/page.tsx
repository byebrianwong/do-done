import Link from "next/link";
import { AisleTermsApi } from "@do-done/api-client";
import { ALL_SHOPPING_NAME, shoppingLists } from "@do-done/shared";
import { ReadError, read } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";
import { ListView } from "../[id]/list-view";
import { AllShoppingHeading } from "./all-shopping-heading";

export const metadata = { title: ALL_SHOPPING_NAME };

/**
 * "All shopping": the items of every shopping list on one page, for a shop
 * that sells from more than one of them. The groceries and the household
 * things both come from Target.
 *
 * A static segment beside `[id]`, which Next.js prefers over the dynamic one.
 * A list's id is a uuid, so `/lists/shopping` can never be a list.
 *
 * The route works with any number of shopping lists, including none: the
 * index and the sidebar only offer it from two, but a bookmark made earlier
 * still has to land somewhere that explains itself.
 */
export default async function AllShoppingPage() {
  const { supabase, userId, tasksApi, projectsApi } = await requireServerApis();

  // `listByKind` returns { projects, lists, error }, so it is unwrapped by hand.
  const [{ lists, error: listsError }, { data: memory }] = await Promise.all([
    projectsApi.listByKind(),
    // Never fails loudly, for the reason the single-list page gives.
    new AisleTermsApi(supabase, userId).load(),
  ]);
  if (listsError) throw new ReadError("your lists", listsError);

  const shopLists = shoppingLists(lists);
  // Sequential, because which lists count comes from the read above.
  const items = await read(
    tasksApi.listItemsIn(shopLists.map((l) => l.id)),
    "your shopping lists' items"
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 text-xs">
        <Link
          href="/lists"
          className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          ← Lists
        </Link>
      </div>

      <AllShoppingHeading lists={shopLists} />

      <ListView
        list={null}
        shoppingLists={shopLists}
        initialItems={items}
        memoryEntries={[...memory.entries()]}
      />
    </div>
  );
}
