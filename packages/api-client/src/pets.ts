import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Pet,
  PetEvent,
  PetGoal,
  PetMood,
  PetEventActor,
  PetGoalProposer,
  AppearanceSeed,
  Task,
  Project,
  PetDecayPreferences,
} from "@do-done/shared";
import {
  computeCurrentStats,
  deriveMood,
  applyTaskDeltas,
  applyCreateEnergy,
  applyEditEnergy,
  taskToDeltaProps,
  taskToCreateEnergyInput,
  DEFAULT_DECAY_PREFERENCES,
  type CurrentStats,
  type TrackedField,
} from "@do-done/shared";
import { TasksApi } from "./tasks.js";

function hexToHue(hex: string): number {
  // Parse "#rrggbb" → HSL hue 0–360. Falls back to indigo (~239) on bad input.
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return 239;
  const r = parseInt(match[1].slice(0, 2), 16) / 255;
  const g = parseInt(match[1].slice(2, 4), 16) / 255;
  const b = parseInt(match[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d) % 6;
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  h *= 60;
  if (h < 0) h += 360;
  return Math.round(h);
}

function hashTagToShape(
  tag: string
): "blob" | "sprout" | "orb" | "tuft" | "wisp" | "pebble" {
  const shapes = ["blob", "sprout", "orb", "tuft", "wisp", "pebble"] as const;
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) | 0;
  }
  return shapes[Math.abs(h) % shapes.length];
}

function eyeStyleFromBirthDay(
  birthedAt: string
): "dot" | "sparkle" | "sleepy" | "wide" {
  const styles = ["dot", "sparkle", "sleepy", "wide"] as const;
  const date = new Date(birthedAt);
  // Day-of-year
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  const day = Math.floor(diff / 86_400_000);
  return styles[day % 4];
}

// ── State shape ────────────────────────────────────────

export interface PetState {
  pet: Pet;
  current_stats: CurrentStats;
  mood: PetMood;
  goals: PetGoal[];
  recent_events: PetEvent[];
}

// ── PetsApi ────────────────────────────────────────────

export class PetsApi {
  constructor(
    private supabase: SupabaseClient,
    private userId?: string
  ) {}

  /**
   * Idempotently inserts a pets row for this user if none exists.
   * Returns the row.
   */
  async ensurePet(): Promise<{ data: Pet | null; error: Error | null }> {
    if (!this.userId) {
      // Without a userId we can still try RLS-based read (auth.uid()), but we
      // can't insert. Try to read what's there.
      const { data, error } = await this.supabase
        .from("pets")
        .select("*")
        .maybeSingle();
      return { data: (data as Pet | null) ?? null, error: error as Error | null };
    }

    const existing = await this.supabase
      .from("pets")
      .select("*")
      .eq("user_id", this.userId)
      .maybeSingle();

    if (existing.error) {
      return { data: null, error: existing.error as Error };
    }
    if (existing.data) {
      return { data: existing.data as Pet, error: null };
    }

    const insert = await this.supabase
      .from("pets")
      .insert({ user_id: this.userId })
      .select()
      .single();
    return {
      data: (insert.data as Pet | null) ?? null,
      error: insert.error as Error | null,
    };
  }

  /**
   * Reads pet + recent events + open goals; runs decay + mood derivation.
   */
  async getState(): Promise<{ data: PetState | null; error: Error | null }> {
    const ensured = await this.ensurePet();
    if (ensured.error) return { data: null, error: ensured.error };
    if (!ensured.data) {
      return { data: null, error: new Error("Failed to load or create pet") };
    }
    const pet = ensured.data;

    const [eventsRes, goalsRes, prefsRes, lastTaskRes] = await Promise.all([
      this._recentEvents(10),
      this._openGoals(),
      this._decayPreferences(),
      this._lastUserActivityAt(),
    ]);

    if (eventsRes.error) return { data: null, error: eventsRes.error };
    if (goalsRes.error) return { data: null, error: goalsRes.error };

    const now = new Date();
    const prefs = prefsRes.data ?? DEFAULT_DECAY_PREFERENCES;
    const current_stats = computeCurrentStats(pet, prefs, now);
    const mood = deriveMood(current_stats, lastTaskRes.data, prefs, now);

    return {
      data: {
        pet,
        current_stats,
        mood,
        goals: goalsRes.data,
        recent_events: eventsRes.data,
      },
      error: null,
    };
  }

  /**
   * Side effect of TasksApi.update when status flips to 'done'.
   * Read pet → compute decayed stats → apply task deltas → write back +
   * insert pet_event (all in sequence; Supabase JS doesn't expose true
   * transactions from the client SDK).
   */
  async feedFromTask(args: {
    task: Task;
    actor: PetEventActor;
  }): Promise<{ data: PetEvent | null; error: Error | null }> {
    const { task, actor } = args;
    const ctx = await this._loadFeedContext();
    if (ctx.error || !ctx.pet) {
      return { data: null, error: ctx.error };
    }
    const { pet, prefs } = ctx;

    const now = new Date();
    const current = computeCurrentStats(pet, prefs, now);
    const { deltas, narrative_hint } = applyTaskDeltas(
      current,
      taskToDeltaProps(task),
      actor,
      prefs,
      now
    );

    return this._persistDelta({
      pet,
      current,
      deltas,
      now,
      event: {
        event_type: "fed",
        task_id: task.id,
        actor,
        narrative: narrative_hint,
      },
    });
  }

  /**
   * Feed Pip a small energy boost when a new task is created. +5 for a plain
   * create, +10 if the task already has effort+priority filled in or a
   * description set (per pet-decay.applyCreateEnergy).
   *
   * Silently no-ops when there's no pet row yet — task creation must not
   * block on pet provisioning.
   */
  async feedFromTaskCreate(args: {
    task: Task;
    actor: PetEventActor;
  }): Promise<{ data: PetEvent | null; error: Error | null }> {
    const { task, actor } = args;
    const ctx = await this._loadFeedContext();
    if (ctx.error || !ctx.pet) return { data: null, error: ctx.error };
    const { pet, prefs } = ctx;

    const { energy, narrative_hint } = applyCreateEnergy(
      taskToCreateEnergyInput(task)
    );
    if (energy === 0) return { data: null, error: null };

    const now = new Date();
    const current = computeCurrentStats(pet, prefs, now);
    return this._persistDelta({
      pet,
      current,
      deltas: { hunger: 0, happiness: 0, energy, xp: 0 },
      now,
      event: {
        event_type: "fed",
        task_id: task.id,
        actor,
        narrative: narrative_hint,
      },
    });
  }

  /**
   * Feed Pip energy for an edit that fills previously-unset fields. +1 per
   * tracked field that transitioned from unset → set. Editing already-set
   * fields yields 0 (per spec).
   */
  async feedFromTaskEdit(args: {
    before: Partial<Record<TrackedField, unknown>>;
    after: Partial<Record<TrackedField, unknown>>;
    task_id: string;
    actor: PetEventActor;
  }): Promise<{ data: PetEvent | null; error: Error | null }> {
    const { energy, narrative_hint } = applyEditEnergy(args.before, args.after);
    if (energy === 0) return { data: null, error: null };

    const ctx = await this._loadFeedContext();
    if (ctx.error || !ctx.pet) return { data: null, error: ctx.error };
    const { pet, prefs } = ctx;

    const now = new Date();
    const current = computeCurrentStats(pet, prefs, now);
    return this._persistDelta({
      pet,
      current,
      deltas: { hunger: 0, happiness: 0, energy, xp: 0 },
      now,
      event: {
        event_type: "fed",
        task_id: args.task_id,
        actor: args.actor,
        narrative: narrative_hint,
      },
    });
  }

  private async _loadFeedContext(): Promise<{
    pet: Pet | null;
    prefs: PetDecayPreferences;
    error: Error | null;
  }> {
    const ensured = await this.ensurePet();
    if (ensured.error) {
      return {
        pet: null,
        prefs: DEFAULT_DECAY_PREFERENCES,
        error: ensured.error,
      };
    }
    if (!ensured.data) {
      return {
        pet: null,
        prefs: DEFAULT_DECAY_PREFERENCES,
        error: new Error("Failed to load or create pet"),
      };
    }
    const prefsRes = await this._decayPreferences();
    return {
      pet: ensured.data,
      prefs: prefsRes.data ?? DEFAULT_DECAY_PREFERENCES,
      error: null,
    };
  }

  private async _persistDelta(args: {
    pet: Pet;
    current: CurrentStats;
    deltas: { hunger: number; happiness: number; energy: number; xp: number };
    now: Date;
    event: {
      event_type: string;
      task_id?: string | null;
      actor: PetEventActor;
      narrative: string;
    };
  }): Promise<{ data: PetEvent | null; error: Error | null }> {
    const { pet, current, deltas, now, event } = args;
    const newHunger = clampInt(current.hunger + deltas.hunger);
    const newHappiness = clampInt(current.happiness + deltas.happiness);
    const newEnergy = clampInt(current.energy + deltas.energy);
    const newXp = Math.max(0, pet.xp + deltas.xp);

    const updateRes = await this.supabase
      .from("pets")
      .update({
        hunger_at_last_seen: newHunger,
        happiness_at_last_seen: newHappiness,
        energy_at_last_seen: newEnergy,
        last_seen_at: now.toISOString(),
        xp: newXp,
      })
      .eq("user_id", pet.user_id);
    if (updateRes.error) {
      return { data: null, error: updateRes.error as Error };
    }

    const insertRes = await this.supabase
      .from("pet_events")
      .insert({
        user_id: pet.user_id,
        event_type: event.event_type,
        task_id: event.task_id ?? null,
        actor: event.actor,
        delta_hunger: deltas.hunger,
        delta_happiness: deltas.happiness,
        delta_energy: deltas.energy,
        delta_xp: deltas.xp,
        narrative: event.narrative,
      })
      .select()
      .single();
    return {
      data: (insertRes.data as PetEvent | null) ?? null,
      error: insertRes.error as Error | null,
    };
  }

  /**
   * Inserts a new pet_goal. Also writes a 'goal_proposed' pet_event for the log.
   */
  async proposeGoal(args: {
    description: string;
    proposedBy: PetGoalProposer;
  }): Promise<{ data: PetGoal | null; error: Error | null }> {
    const { description, proposedBy } = args;
    if (!this.userId) {
      return {
        data: null,
        error: new Error("PetsApi.proposeGoal requires userId"),
      };
    }

    const goalRes = await this.supabase
      .from("pet_goals")
      .insert({
        user_id: this.userId,
        description,
        proposed_by: proposedBy,
        status: "open",
      })
      .select()
      .single();
    if (goalRes.error) {
      return { data: null, error: goalRes.error as Error };
    }

    const actor: PetEventActor =
      proposedBy === "claude"
        ? "claude"
        : proposedBy === "user"
          ? "user"
          : "system";
    await this.supabase.from("pet_events").insert({
      user_id: this.userId,
      event_type: "goal_proposed",
      actor,
      narrative: description,
    });

    return { data: goalRes.data as PetGoal, error: null };
  }

  /**
   * Accept an open goal: create a real task linked to the goal, mark accepted.
   */
  async acceptGoal(
    goalId: string
  ): Promise<{
    data: { goal: PetGoal; task: Task } | null;
    error: Error | null;
  }> {
    const fetchRes = await this.supabase
      .from("pet_goals")
      .select("*")
      .eq("id", goalId)
      .single();
    if (fetchRes.error || !fetchRes.data) {
      return {
        data: null,
        error: (fetchRes.error as Error) ?? new Error("Goal not found"),
      };
    }
    const goal = fetchRes.data as PetGoal;
    if (goal.status !== "open") {
      return {
        data: null,
        error: new Error(`Goal is ${goal.status}, not open`),
      };
    }

    const tasks = new TasksApi(this.supabase, this.userId);
    const taskRes = await tasks.create({ title: goal.description });
    if (taskRes.error || !taskRes.data) {
      return {
        data: null,
        error: (taskRes.error as Error) ?? new Error("Task create failed"),
      };
    }

    const updateRes = await this.supabase
      .from("pet_goals")
      .update({ status: "accepted", task_id: taskRes.data.id })
      .eq("id", goalId)
      .select()
      .single();
    if (updateRes.error || !updateRes.data) {
      return {
        data: null,
        error: (updateRes.error as Error) ?? new Error("Goal update failed"),
      };
    }

    if (this.userId) {
      await this.supabase.from("pet_events").insert({
        user_id: this.userId,
        event_type: "goal_accepted",
        task_id: taskRes.data.id,
        actor: "user",
        narrative: goal.description,
      });
    }

    return {
      data: { goal: updateRes.data as PetGoal, task: taskRes.data },
      error: null,
    };
  }

  /**
   * Record a free-form narrative event (event_type='narrated') tied to an
   * optional task. Used by the MCP `narrate_task_completion` tool so Claude
   * can leave color commentary in the pet activity log.
   */
  async recordNarrative(args: {
    narrative: string;
    task_id?: string | null;
    actor: PetEventActor;
  }): Promise<{ data: PetEvent | null; error: Error | null }> {
    if (!this.userId) {
      return {
        data: null,
        error: new Error("PetsApi.recordNarrative requires userId"),
      };
    }
    const insertRes = await this.supabase
      .from("pet_events")
      .insert({
        user_id: this.userId,
        event_type: "narrated",
        task_id: args.task_id ?? null,
        actor: args.actor,
        narrative: args.narrative,
      })
      .select()
      .single();
    return {
      data: (insertRes.data as PetEvent | null) ?? null,
      error: insertRes.error as Error | null,
    };
  }

  /**
   * Mark an open goal as declined. No-op if the goal isn't open.
   */
  async declineGoal(
    goalId: string
  ): Promise<{ data: PetGoal | null; error: Error | null }> {
    const updateRes = await this.supabase
      .from("pet_goals")
      .update({ status: "declined" })
      .eq("id", goalId)
      .eq("status", "open")
      .select()
      .maybeSingle();
    return {
      data: (updateRes.data as PetGoal | null) ?? null,
      error: updateRes.error as Error | null,
    };
  }

  /**
   * Recent events for the activity log.
   */
  async getHistory(
    limit: number = 20
  ): Promise<{ data: PetEvent[]; error: Error | null }> {
    return this._recentEvents(limit);
  }

  /**
   * Recompute appearance_seed from this user's task corpus.
   *
   * - bodyHue: hue of the user's most-used project color (counted by task count).
   * - bodyShape: hash of the user's most-common tag.
   * - eyeStyle: derived from pet's birth day-of-year (stable, not corpus-derived).
   * - accessories: empty for v1 (xp milestone unlocks come later).
   */
  async regenerateAppearanceSeed(): Promise<{
    data: AppearanceSeed | null;
    error: Error | null;
  }> {
    const ensured = await this.ensurePet();
    if (ensured.error) return { data: null, error: ensured.error };
    if (!ensured.data) {
      return { data: null, error: new Error("Failed to load pet") };
    }
    const pet = ensured.data;

    // Top project by task count. Shopping lists are excluded from every tally
    // below: the pet is a picture of the user's work, and a list that refills
    // every week would win "top project" outright and dye the pet its colour.
    let projectsQuery = this.supabase
      .from("tasks")
      .select("project_id")
      .is("deleted_at", null)
      .eq("is_list_item", false);
    if (this.userId) projectsQuery = projectsQuery.eq("user_id", this.userId);
    const tasksRes = await projectsQuery;
    if (tasksRes.error) {
      return { data: null, error: tasksRes.error as Error };
    }

    const projectCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    for (const row of (tasksRes.data ?? []) as Array<{
      project_id: string | null;
    }>) {
      if (row.project_id) {
        projectCounts.set(
          row.project_id,
          (projectCounts.get(row.project_id) ?? 0) + 1
        );
      }
    }

    let topProjectId: string | null = null;
    let topCount = 0;
    for (const [pid, count] of projectCounts) {
      if (count > topCount) {
        topCount = count;
        topProjectId = pid;
      }
    }

    let bodyHue = 239; // indigo default
    if (topProjectId) {
      const projRes = await this.supabase
        .from("projects")
        .select("color")
        .eq("id", topProjectId)
        .single();
      const proj = projRes.data as Pick<Project, "color"> | null;
      if (proj?.color) bodyHue = hexToHue(proj.color);
    }

    // Most common tag — separate query because Supabase doesn't aggregate
    // array columns with .select(), so we pull tag arrays and tally.
    let tagsQuery = this.supabase
      .from("tasks")
      .select("tags")
      .is("deleted_at", null)
      // Store hints ride in `tags` (`at:Costco`), so without this the pet's
      // "most common tag" would eventually be a supermarket.
      .eq("is_list_item", false);
    if (this.userId) tagsQuery = tagsQuery.eq("user_id", this.userId);
    const tagsRes = await tagsQuery;
    if (!tagsRes.error) {
      for (const row of (tagsRes.data ?? []) as Array<{ tags: string[] | null }>) {
        for (const tag of row.tags ?? []) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
    }

    let topTag = "blob";
    let topTagCount = 0;
    for (const [tag, count] of tagCounts) {
      if (count > topTagCount) {
        topTagCount = count;
        topTag = tag;
      }
    }

    const seed: AppearanceSeed = {
      bodyHue,
      bodyShape: hashTagToShape(topTag),
      eyeStyle: eyeStyleFromBirthDay(pet.birthed_at),
      accessories: [],
    };

    const writeRes = await this.supabase
      .from("pets")
      .update({ appearance_seed: seed })
      .eq("user_id", pet.user_id);
    if (writeRes.error) {
      return { data: null, error: writeRes.error as Error };
    }

    return { data: seed, error: null };
  }

  // ── Internal helpers ─────────────────────────────────

  private async _recentEvents(
    limit: number
  ): Promise<{ data: PetEvent[]; error: Error | null }> {
    let query = this.supabase
      .from("pet_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    return {
      data: (data as PetEvent[]) ?? [],
      error: error as Error | null,
    };
  }

  private async _openGoals(): Promise<{
    data: PetGoal[];
    error: Error | null;
  }> {
    let query = this.supabase
      .from("pet_goals")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query;
    return {
      data: (data as PetGoal[]) ?? [],
      error: error as Error | null,
    };
  }

  private async _decayPreferences(): Promise<{
    data: PetDecayPreferences | null;
    error: Error | null;
  }> {
    let query = this.supabase
      .from("user_preferences")
      .select("timezone, hunger_daily_decay, happiness_weekly_decay, week_end_day")
      .limit(1);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      return { data: null, error: error as Error | null };
    }
    const row = data as {
      timezone?: string;
      hunger_daily_decay?: number;
      happiness_weekly_decay?: number;
      week_end_day?: number;
    };
    return {
      data: {
        timezone: row.timezone ?? DEFAULT_DECAY_PREFERENCES.timezone,
        hunger_daily_decay:
          row.hunger_daily_decay ?? DEFAULT_DECAY_PREFERENCES.hunger_daily_decay,
        happiness_weekly_decay:
          row.happiness_weekly_decay ??
          DEFAULT_DECAY_PREFERENCES.happiness_weekly_decay,
        week_end_day:
          row.week_end_day ?? DEFAULT_DECAY_PREFERENCES.week_end_day,
      },
      error: null,
    };
  }

  private async _lastUserActivityAt(): Promise<{
    data: Date | null;
    error: Error | null;
  }> {
    // Use the most recent task update as a cheap proxy for "last user activity".
    let query = this.supabase
      .from("tasks")
      .select("updated_at")
      // Adding milk to a list is activity, but it is not the kind this proxy
      // stands in for — the pet decays on neglected *work*, and a weekly shop
      // would keep it fed forever without a single task being touched.
      .eq("is_list_item", false)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (this.userId) query = query.eq("user_id", this.userId);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return { data: null, error: (error as Error) ?? null };
    const ts = (data as { updated_at?: string }).updated_at;
    return { data: ts ? new Date(ts) : null, error: null };
  }
}

function clampInt(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}
