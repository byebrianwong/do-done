import type { SupabaseClient } from "@supabase/supabase-js";
import type { Aisle, AisleMemory } from "@do-done/shared";
import { isAisle, learnableTerm } from "@do-done/shared";

/**
 * What the user has taught DoDone about their own words.
 *
 * A correction to an item's aisle is two writes, not one: a tag on that row so
 * it is right immediately, and a row here so it is right *next week too* — a
 * shopping list is standing, and the same words come back after the old items
 * have been cleared and purged.
 *
 * Small on purpose. The whole map is read once per session and held; there is
 * no per-lookup query, because the lookup happens while grouping a list.
 */
export class AisleTermsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  /**
   * Everything this user has taught, as the map `groupByAisle` takes.
   *
   * Never throws and never returns a partial answer with an error beside it: a
   * memory that fails to load must degrade to *the lexicon's guess*, which is
   * a good answer, rather than to a broken list. Callers pass the map straight
   * into grouping, so an empty one is already the correct fallback.
   */
  async load(): Promise<{ data: AisleMemory; error: Error | null }> {
    let query = this.supabase.from("list_term_aisles").select("term, aisle");
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    if (error) return { data: new Map(), error: error as Error };

    const memory = new Map<string, Aisle>();
    for (const row of (data ?? []) as Array<{ term: string; aisle: string }>) {
      // Guard the value: the column has a check constraint, but a client
      // running ahead of a migration that adds an aisle would otherwise put a
      // string it can't render into the map.
      if (isAisle(row.aisle)) memory.set(row.term, row.aisle);
    }
    return { data: memory, error: null };
  }

  /**
   * Teach, or correct a previous lesson.
   *
   * An upsert on the composite primary key, which is what makes two devices
   * correcting the same word settle on last-writer-wins instead of colliding.
   * The term is derived here rather than taken from the caller so every writer
   * keys lessons the same way the reader looks them up.
   */
  async learn(
    title: string,
    aisle: Aisle
  ): Promise<{ term: string | null; error: Error | null }> {
    const term = learnableTerm(title);
    if (!term || !this.userId) return { term: null, error: null };

    const { error } = await this.supabase
      .from("list_term_aisles")
      .upsert(
        { user_id: this.userId, term, aisle, updated_at: new Date().toISOString() },
        { onConflict: "user_id,term" }
      );
    return { term, error: (error as Error) ?? null };
  }

  /**
   * Un-teach — what "Automatic" on the picker means.
   *
   * Deleting the lesson rather than storing a null is what lets the lexicon
   * take the word back: a stored "no aisle" would be a third state that has to
   * beat the guess, and nothing in the UI means that.
   */
  async forget(title: string): Promise<{ error: Error | null }> {
    const term = learnableTerm(title);
    if (!term || !this.userId) return { error: null };

    const { error } = await this.supabase
      .from("list_term_aisles")
      .delete()
      .eq("user_id", this.userId)
      .eq("term", term);
    return { error: (error as Error) ?? null };
  }
}
