import { z } from "zod";

// ── Enums ──────────────────────────────────────────────

export const TaskStatus = z.enum([
  "inbox",
  "todo",
  "in_progress",
  "done",
  "archived",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(["p1", "p2", "p3", "p4"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const TriggerType = z.enum(["enter", "exit"]);
export type TriggerType = z.infer<typeof TriggerType>;

export const ThemeMode = z.enum(["light", "dark", "system"]);
export type ThemeMode = z.infer<typeof ThemeMode>;

// ── Core Schemas ───────────────────────────────────────

export const TaskSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullable(),
  status: TaskStatus.default("inbox"),
  priority: TaskPriority.default("p4"),
  project_id: z.string().uuid().nullable(),
  due_date: z.string().date().nullable(),
  due_time: z.string().nullable(), // HH:MM format
  duration_minutes: z.number().int().positive().nullable(),
  recurrence_rule: z.string().nullable(), // RRULE format
  calendar_event_id: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  sort_order: z.number().int().default(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});
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
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// ── Input Schemas (for create/update operations) ───────

export const CreateTaskInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  project_id: z.string().uuid().optional(),
  due_date: z.string().date().optional(),
  due_time: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  recurrence_rule: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const UpdateTaskInput = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  project_id: z.string().uuid().nullable().optional(),
  due_date: z.string().date().nullable().optional(),
  due_time: z.string().nullable().optional(),
  duration_minutes: z.number().int().positive().nullable().optional(),
  recurrence_rule: z.string().nullable().optional(),
  calendar_event_id: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  sort_order: z.number().int().optional(),
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
