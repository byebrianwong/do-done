import type { SupabaseClient } from "@supabase/supabase-js";
import type { PantryEntry } from "@do-done/shared";
import { learnableTerm } from "@do-done/shared";

/**
 * Reads and writes what the user has bought on a list before.
 *
 * Shaped like `AisleTermsApi`, for the same reason: list items are put away and
 * purged after every shop, so anything worth remembering across shops has to be
 * stored where the purge cannot reach it.
 *
 * The API is small on purpose. A list's pantry is read once per screen and held
 * in memory; there is no per-item query, since lookups happen while rendering.
 */
export class PantryApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  /**
   * Loads one list's pantry, most recently bought first.
   *
   * Never throws. A failed load returns an empty array, so the screen falls
   * back to a plain shopping list — which is what it was before this existed
   * and is still useful. Failing the whole screen because a drawer did not load
   * would be much worse, especially with the phone in your hand in a shop.
   */
  async load(listId: string): Promise<{ data: PantryEntry[]; error: Error | null }> {
    let query = this.supabase
      .from("list_pantry")
      .select("term, title, last_bought_at, buy_count, gaps, store")
      .eq("list_id", listId)
      .order("last_bought_at", { ascending: false });
    if (this.userId) query = query.eq("user_id", this.userId);

    const { data, error } = await query;
    if (error) return { data: [], error: error as Error };
    return { data: (data ?? []).map(normalizeEntry), error: null };
  }

  /**
   * Records that an item was bought.
   *
   * One atomic RPC. Reading the entry, computing the gap here, and writing it
   * back would take two round trips on the most repeated action in the app, and
   * would lose a buy when two devices tick the same item at once.
   * `record_pantry_buy` computes the gap in the same statement that stores it.
   * It ignores same-day repeats, so tick / untick / tick cannot inflate the
   * count or record a zero-day gap.
   */
  async record(
    listId: string,
    title: string,
    store: string | null = null
  ): Promise<{ term: string | null; error: Error | null }> {
    const term = learnableTerm(title);
    if (!term || !this.userId) return { term: null, error: null };

    const { error } = await this.supabase.rpc("record_pantry_buy", {
      p_list_id: listId,
      p_term: term,
      p_title: title.trim().slice(0, 500),
      p_store: store,
    });
    return { term, error: (error as Error) ?? null };
  }

  /**
   * Deletes an entry. This is the only destructive operation on the pantry.
   *
   * Putting a list away is now safe, so it stays a single tap. The friction
   * moved here instead, onto the one action that cannot be undone: deciding you
   * will never buy something again, one item at a time.
   */
  async forget(listId: string, term: string): Promise<{ error: Error | null }> {
    if (!this.userId) return { error: null };
    const { error } = await this.supabase
      .from("list_pantry")
      .delete()
      .eq("user_id", this.userId)
      .eq("list_id", listId)
      .eq("term", term);
    return { error: (error as Error) ?? null };
  }
}

/**
 * Converts a database row into the shape the app expects.
 *
 * `gaps` defaults to an empty array and `buy_count` to 1 so that a client
 * running ahead of its migration, or reading a row written by an older one,
 * degrades to "bought once, rhythm unknown" instead of crashing.
 */
function normalizeEntry(row: Record<string, unknown>): PantryEntry {
  return {
    term: String(row.term ?? ""),
    title: String(row.title ?? ""),
    last_bought_at: String(row.last_bought_at ?? new Date().toISOString()),
    buy_count: typeof row.buy_count === "number" ? row.buy_count : 1,
    gaps: Array.isArray(row.gaps) ? (row.gaps as number[]) : [],
    store: typeof row.store === "string" && row.store ? row.store : null,
  };
}
