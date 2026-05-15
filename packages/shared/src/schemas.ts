import { z } from "zod";

// ── Enums ──────────────────────────────────────────────

export const TaskStatus = z.enum([
  "inbox",
  "not_started",
  "next",
  "in_progress",
  "done",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(["p1", "p2", "p3", "p4"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

// Fuzzy scheduling windows for when_bucket. Distinct from a specific
// when_date — see TaskSchema for the mutually-exclusive rule.
export const WhenBucket = z.enum([
  "today",
  "tomorrow",
  "this_week",
  "next_week",
  "later",
  "someday",
]);
export type WhenBucket = z.infer<typeof WhenBucket>;

// Subtask depth: 0 = main task, 1 = subtask, 2 = sub-subtask. Max 3 levels.
export const TaskDepth = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type TaskDepth = z.infer<typeof TaskDepth>;

export const TriggerType = z.enum(["enter", "exit"]);
export type TriggerType = z.infer<typeof TriggerType>;

export const ThemeMode = z.enum(["light", "dark", "system"]);
export type ThemeMode = z.infer<typeof ThemeMode>;

// ── Core Schemas ───────────────────────────────────────

export const TaskSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    title: z.string().min(1).max(500),
    description: z.string().max(5000).nullable(),
    status: TaskStatus.default("inbox"),
    priority: TaskPriority.default("p4"),
    project_id: z.string().uuid().nullable(),
    // when = the day the user plans to do this (Things-3-style "do date").
    // Distinct from due_date which is a hard deadline. At most one of
    // when_date and when_bucket is non-null — see refinement below.
    when_date: z.string().date().nullable(),
    when_bucket: WhenBucket.nullable(),
    due_date: z.string().date().nullable(),
    due_time: z.string().nullable(), // HH:MM format
    duration_minutes: z.number().int().positive().nullable(),
    recurrence_rule: z.string().nullable(), // RRULE format
    calendar_event_id: z.string().nullable(),
    tags: z.array(z.string()).default([]),
    // Subtask tree. parent_task_id null = main task. depth is enforced by
    // a DB trigger (max 2, i.e. 3 levels). The application must keep the
    // two in sync; reading code can rely on depth being correct.
    parent_task_id: z.string().uuid().nullable(),
    depth: TaskDepth.default(0),
    sort_order: z.number().int().default(0),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    completed_at: z.string().datetime().nullable(),
  })
  .refine(
    (t) => !(t.when_date !== null && t.when_bucket !== null),
    {
      message: "when_date and when_bucket are mutually exclusive",
      path: ["when_bucket"],
    }
  );
export type Task = z.infer<typeof TaskSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().max(10).nullable(),
  parent_project_id: z.string().uuid().nullable(),
  sort_order: z.number().int().default(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const LocationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_meters: z.number().positive().default(100),
  address: z.string().max(500).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Location = z.infer<typeof LocationSchema>;

export const TaskLocationSchema = z.object({
  task_id: z.string().uuid(),
  location_id: z.string().uuid(),
  trigger_type: TriggerType,
});
export type TaskLocation = z.infer<typeof TaskLocationSchema>;

export const CalendarSyncSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  google_refresh_token: z.string(),
  google_access_token: z.string().nullable(),
  last_sync_token: z.string().nullable(),
  synced_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type CalendarSync = z.infer<typeof CalendarSyncSchema>;

export const UserPreferencesSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  default_view: z.enum(["inbox", "today", "upcoming"]).default("today"),
  theme: ThemeMode.default("system"),
  timezone: z.string().default("America/New_York"),
  focus_hours_start: z.number().int().min(0).max(23).default(9),
  focus_hours_end: z.number().int().min(0).max(23).default(17),
  hunger_daily_decay: z.number().int().min(0).max(50).default(3),
  happiness_weekly_decay: z.number().int().min(0).max(100).default(10),
  // 0 = Sunday, 6 = Saturday. Default Sunday matches the spec's
  // "default is end is Sunday" — the once-per-week happiness tick fires at
  // the end of this weekday in the user's local timezone.
  week_end_day: z.number().int().min(0).max(6).default(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// Pure decay-settings projection used by pet-decay.ts. Decouples the math
// from the shape of UserPreferences so tests can pass plain literals.
export interface PetDecayPreferences {
  timezone: string;
  hunger_daily_decay: number;
  happiness_weekly_decay: number;
  week_end_day: number;
}

export const DEFAULT_DECAY_PREFERENCES: PetDecayPreferences = {
  timezone: "America/New_York",
  hunger_daily_decay: 3,
  happiness_weekly_decay: 10,
  week_end_day: 0,
};

// ── Input Schemas (for create/update operations) ───────

// Shared refinement: at most one of when_date / when_bucket is set.
// Used by both CreateTaskInput and UpdateTaskInput.
const whenExclusive = <T extends { when_date?: unknown; when_bucket?: unknown }>(
  t: T
) =>
  !(
    t.when_date !== undefined &&
    t.when_date !== null &&
    t.when_bucket !== undefined &&
    t.when_bucket !== null
  );

export const CreateTaskInput = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    status: TaskStatus.optional(),
    priority: TaskPriority.optional(),
    project_id: z.string().uuid().optional(),
    when_date: z.string().date().optional(),
    when_bucket: WhenBucket.optional(),
    due_date: z.string().date().optional(),
    due_time: z.string().optional(),
    duration_minutes: z.number().int().positive().optional(),
    recurrence_rule: z.string().optional(),
    tags: z.array(z.string()).optional(),
    parent_task_id: z.string().uuid().optional(),
  })
  .refine(whenExclusive, {
    message: "when_date and when_bucket are mutually exclusive",
    path: ["when_bucket"],
  });
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const UpdateTaskInput = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: TaskStatus.optional(),
    priority: TaskPriority.optional(),
    project_id: z.string().uuid().nullable().optional(),
    when_date: z.string().date().nullable().optional(),
    when_bucket: WhenBucket.nullable().optional(),
    due_date: z.string().date().nullable().optional(),
    due_time: z.string().nullable().optional(),
    duration_minutes: z.number().int().positive().nullable().optional(),
    recurrence_rule: z.string().nullable().optional(),
    calendar_event_id: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    parent_task_id: z.string().uuid().nullable().optional(),
    sort_order: z.number().int().optional(),
  })
  .refine(whenExclusive, {
    message: "when_date and when_bucket are mutually exclusive",
    path: ["when_bucket"],
  });
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6366f1"),
  icon: z.string().max(10).optional(),
  parent_project_id: z.string().uuid().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const CreateLocationInput = z.object({
  name: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_meters: z.number().positive().default(100),
  address: z.string().max(500).optional(),
});
export type CreateLocationInput = z.infer<typeof CreateLocationInput>;

export const TaskFilterInput = z.object({
  status: TaskStatus.optional(),
  project_id: z.string().uuid().optional(),
  priority: TaskPriority.optional(),
  due_before: z.string().date().optional(),
  due_after: z.string().date().optional(),
  search_query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export type TaskFilterInput = z.infer<typeof TaskFilterInput>;

// ── Parsed Task (from NLP) ─────────────────────────────

export const ParsedTaskSchema = z.object({
  title: z.string(),
  when_date: z.string().date().optional(),
  when_bucket: WhenBucket.optional(),
  due_date: z.string().date().optional(),
  due_time: z.string().optional(),
  priority: TaskPriority.optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  duration_minutes: z.number().optional(),
  recurrence_rule: z.string().optional(),
});
export type ParsedTask = z.infer<typeof ParsedTaskSchema>;

// ── Weekly Summary ─────────────────────────────────────

export const WeeklySummarySchema = z.object({
  completed_count: z.number(),
  created_count: z.number(),
  completion_rate: z.number(),
  overdue_count: z.number(),
  most_productive_day: z.string().nullable(),
  priority_distribution: z.record(TaskPriority, z.number()),
  top_projects: z.array(
    z.object({
      name: z.string(),
      completed: z.number(),
    })
  ),
});
export type WeeklySummary = z.infer<typeof WeeklySummarySchema>;

// ── Pet ("Pip") ────────────────────────────────────────

// Pip is intentionally a positive companion — there is no "sad" mood.
// Stat thresholds (hungry/tired) remain as soft "needs care" cues; everything
// else cycles among positive expression variants over the course of the day.
export const PetMoodEnum = z.enum([
  "happy",
  "content",
  "curious",
  "playful",
  "cozy",
  "thoughtful",
  "tired",
  "hungry",
  "sleeping",
]);
export type PetMood = z.infer<typeof PetMoodEnum>;

// Moods that cycle randomly throughout the day when no stat threshold triggers
// a care cue. `deriveMood` picks one of these by time bucket.
export const ROTATING_POSITIVE_MOODS: PetMood[] = [
  "happy",
  "content",
  "curious",
  "playful",
  "cozy",
  "thoughtful",
];

export const PetEventActorEnum = z.enum(["user", "claude", "system"]);
export type PetEventActor = z.infer<typeof PetEventActorEnum>;

export const PetGoalStatusEnum = z.enum([
  "open",
  "accepted",
  "completed",
  "declined",
  "expired",
]);
export type PetGoalStatus = z.infer<typeof PetGoalStatusEnum>;

export const PetGoalProposerEnum = z.enum(["claude", "pet", "user"]);
export type PetGoalProposer = z.infer<typeof PetGoalProposerEnum>;

export const PetEventTypeEnum = z.enum([
  "fed",
  "goal_proposed",
  "goal_accepted",
  "goal_completed",
  "evolved",
  "sad",
  "narrated",
]);
export type PetEventType = z.infer<typeof PetEventTypeEnum>;

export const PetBodyShapeEnum = z.enum([
  "blob",
  "sprout",
  "orb",
  "tuft",
  "wisp",
  "pebble",
]);
export type PetBodyShape = z.infer<typeof PetBodyShapeEnum>;

export const PetEyeStyleEnum = z.enum(["dot", "sparkle", "sleepy", "wide"]);
export type PetEyeStyle = z.infer<typeof PetEyeStyleEnum>;

export const AppearanceSeedSchema = z.object({
  bodyHue: z.number().min(0).max(360),
  bodyShape: PetBodyShapeEnum,
  eyeStyle: PetEyeStyleEnum,
  accessories: z.array(z.string()).default([]),
});
export type AppearanceSeed = z.infer<typeof AppearanceSeedSchema>;

export const PetSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().min(1).max(30),
  birthed_at: z.string().datetime(),
  hunger_at_last_seen: z.number().int().min(0).max(100),
  happiness_at_last_seen: z.number().int().min(0).max(100),
  energy_at_last_seen: z.number().int().min(0).max(100),
  last_seen_at: z.string().datetime(),
  // appearance_seed is a JSONB column; it may be an empty object before
  // regeneration, so we accept any record shape and validate the populated
  // form with AppearanceSeedSchema separately.
  appearance_seed: z.record(z.string(), z.unknown()),
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Pet = z.infer<typeof PetSchema>;

export const PetGoalSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  description: z.string().min(1).max(200),
  proposed_by: PetGoalProposerEnum,
  status: PetGoalStatusEnum.default("open"),
  task_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
export type PetGoal = z.infer<typeof PetGoalSchema>;

export const PetEventSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  event_type: PetEventTypeEnum,
  task_id: z.string().uuid().nullable(),
  actor: PetEventActorEnum,
  delta_hunger: z.number().int().default(0),
  delta_happiness: z.number().int().default(0),
  delta_energy: z.number().int().default(0),
  delta_xp: z.number().int().default(0),
  narrative: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type PetEvent = z.infer<typeof PetEventSchema>;

export const CreatePetGoalInput = z.object({
  description: z.string().min(1).max(200),
  proposed_by: PetGoalProposerEnum,
});
export type CreatePetGoalInput = z.infer<typeof CreatePetGoalInput>;
