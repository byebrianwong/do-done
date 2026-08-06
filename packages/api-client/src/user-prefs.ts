import type { SupabaseClient } from "@supabase/supabase-js";
import type { UpdateStatusSyncInput, UserPreferences } from "@do-done/shared";

// Subset writable via the pet settings panel.
export interface PetSettingsPatch {
  hunger_daily_decay?: number;
  happiness_weekly_decay?: number;
  week_end_day?: number;
}

export class UserPrefsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  /**
   * Read the current user's preferences row, inserting defaults if missing.
   */
  async get(): Promise<{
    data: UserPreferences | null;
    error: Error | null;
  }> {
    let query = this.supabase.from("user_preferences").select("*").limit(1);
    if (this.userId) query = query.eq("user_id", this.userId);
    const existing = await query.maybeSingle();
    if (existing.error) {
      return { data: null, error: existing.error as Error };
    }
    if (existing.data) {
      return { data: existing.data as UserPreferences, error: null };
    }
    if (!this.userId) {
      return {
        data: null,
        error: new Error("UserPrefsApi.get requires userId to insert defaults"),
      };
    }
    const insert = await this.supabase
      .from("user_preferences")
      .insert({ user_id: this.userId })
      .select()
      .single();
    return {
      data: (insert.data as UserPreferences | null) ?? null,
      error: insert.error as Error | null,
    };
  }

  /**
   * Apply a partial update to the prefs row, inserting a defaults row (with
   * the patch applied) when none exists yet. RLS handles the user filter; we
   * still scope by user_id when available to match the rest of the API
   * surface. All public update methods delegate here so the update-or-seed
   * dance lives in exactly one place.
   */
  private async patchPrefs(
    patch: Record<string, unknown>,
    label: string
  ): Promise<{ data: UserPreferences | null; error: Error | null }> {
    let query = this.supabase.from("user_preferences").update(patch);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query.select().maybeSingle();
    if (error) return { data: null, error: error as Error };
    if (data) return { data: data as UserPreferences, error: null };
    // No row yet — insert with the patch values applied to defaults.
    if (!this.userId) {
      return {
        data: null,
        error: new Error(`${label} requires userId to seed defaults`),
      };
    }
    const insert = await this.supabase
      .from("user_preferences")
      .insert({ user_id: this.userId, ...patch })
      .select()
      .single();
    return {
      data: (insert.data as UserPreferences | null) ?? null,
      error: insert.error as Error | null,
    };
  }

  /** Update the pet settings subset. */
  async updatePetSettings(
    patch: PetSettingsPatch
  ): Promise<{ data: UserPreferences | null; error: Error | null }> {
    if (Object.keys(patch).length === 0) {
      // Nothing to write — short-circuit a `.get()` so the caller still gets
      // the current row back.
      return this.get();
    }
    return this.patchPrefs({ ...patch }, "UserPrefsApi.updatePetSettings");
  }

  /**
   * Update the user's IANA timezone (e.g. "America/Los_Angeles"). Seeds a
   * defaults row if none exists yet.
   */
  async updateTimezone(
    timezone: string
  ): Promise<{ data: UserPreferences | null; error: Error | null }> {
    return this.patchPrefs({ timezone }, "updateTimezone");
  }

  /**
   * Toggle whether Google Calendar events are shown inside DoDone views.
   * Seeds a defaults row if none exists yet.
   */
  async updateShowCalendarEvents(
    show: boolean
  ): Promise<{ data: UserPreferences | null; error: Error | null }> {
    return this.patchPrefs(
      { show_calendar_events: show },
      "updateShowCalendarEvents"
    );
  }

  /**
   * Replace the set of Google calendar ids hidden from DoDone views. Stores
   * the exclusion set, so any calendar not named here — including one created
   * after this write — shows by default. Seeds a defaults row if none exists.
   */
  async updateHiddenCalendars(
    hiddenIds: string[]
  ): Promise<{ data: UserPreferences | null; error: Error | null }> {
    return this.patchPrefs(
      { hidden_calendar_ids: hiddenIds },
      "updateHiddenCalendars"
    );
  }

  /**
   * Update the status ↔ schedule auto-sync settings. Accepts any subset, so
   * the settings UI can write one switch at a time. Seeds a defaults row if
   * none exists yet.
   */
  async updateStatusSync(
    patch: UpdateStatusSyncInput
  ): Promise<{ data: UserPreferences | null; error: Error | null }> {
    if (Object.keys(patch).length === 0) return this.get();
    return this.patchPrefs({ ...patch }, "UserPrefsApi.updateStatusSync");
  }

  /**
   * Read the per-view Display preferences map (viewKey -> DisplayConfig).
   * Read-only (no insert) — returns {} when there's no prefs row yet. Callers
   * validate each entry with `parseDisplayConfig` from @do-done/shared.
   */
  async getDisplayPrefs(): Promise<{
    data: Record<string, unknown>;
    error: Error | null;
  }> {
    let query = this.supabase
      .from("user_preferences")
      .select("display_prefs")
      .limit(1);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query.maybeSingle();
    if (error) return { data: {}, error: error as Error };
    return {
      data: (data?.display_prefs as Record<string, unknown> | undefined) ?? {},
      error: null,
    };
  }

  /**
   * Upsert a single view's DisplayConfig atomically via the
   * `set_display_pref` SQL function (jsonb_set), so concurrent writes to
   * different views don't clobber each other and the prefs row is created on
   * first write.
   */
  async setDisplayPref(
    viewKey: string,
    config: unknown
  ): Promise<{ error: Error | null }> {
    const { error } = await this.supabase.rpc("set_display_pref", {
      p_view_key: viewKey,
      p_config: config,
    });
    return { error: error as Error | null };
  }
}
