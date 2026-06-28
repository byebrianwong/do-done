import { parseTaskInput } from "@do-done/task-engine";
import type {
  CreateTaskInput,
  GroupDropTarget,
  TaskPriority,
  TaskStatus,
} from "@do-done/shared";

/**
 * The subset of a new task that a *context* (a list section or date column)
 * implies. Quick-add merges this under whatever the user types so a task added
 * inside the "P1" section is P1, a task added under "Friday" lands on Friday,
 * etc. Mirrors the fields `GroupDropTarget` can address.
 */
export type QuickAddSeed = Partial<
  Pick<CreateTaskInput, "status" | "priority" | "project_id" | "when_date">
>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a natural-language quick-add string and layer the section's seed on top
 * to produce the `CreateTaskInput` for `TasksApi.create`.
 *
 * Precedence (explicit typing wins, *except* the axis that defines the section —
 * you can't add to the "P1" column and not get P1):
 *  - title       ← parsed only
 *  - when_date   ← seed wins when set (the column IS the date), else parsed
 *  - status      ← seed wins when set, else default
 *  - priority    ← parsed wins over seed (the one genuine collision)
 *  - project_id  ← seed wins (the parser yields a name, never a UUID)
 *  - tags / due_* / duration / recurrence ← parsed only
 *
 * `parsed.project` is a *name* (`/groceries`), not a UUID, so it cannot become
 * `project_id` — it is intentionally dropped (the chips set `project_id`).
 */
export function buildCreateInput(
  raw: string,
  seed: QuickAddSeed = {},
  referenceDate?: Date
): CreateTaskInput {
  const parsed = parseTaskInput(raw, referenceDate);

  const input: CreateTaskInput = {
    title: parsed.title,
    ...(parsed.priority && { priority: parsed.priority }),
    ...(parsed.when_date && { when_date: parsed.when_date }),
    ...(parsed.when_time && { when_time: parsed.when_time }),
    ...(parsed.due_date && { due_date: parsed.due_date }),
    ...(parsed.due_time && { due_time: parsed.due_time }),
    ...(parsed.duration_minutes && { duration_minutes: parsed.duration_minutes }),
    ...(parsed.tags && parsed.tags.length > 0 && { tags: parsed.tags }),
    ...(parsed.recurrence_rule && { recurrence_rule: parsed.recurrence_rule }),
  };

  // Section axis wins for status (parser never sets it).
  if (seed.status) input.status = seed.status;

  // Typed priority wins; otherwise inherit the section's priority.
  if (!input.priority && seed.priority) input.priority = seed.priority;

  // The parser can't produce a project_id, so the section's project applies.
  if (seed.project_id) input.project_id = seed.project_id;

  // The column IS the date: a seeded when_date wins over a typed one.
  if (seed.when_date) input.when_date = seed.when_date;

  return input;
}

/**
 * Layer explicit, user-chosen fields (e.g. the quick-add modal's When / Priority
 * / Project / Estimate chips) on top of a built input. These win over both the
 * parsed text and the section seed, since picking a chip is a deliberate act.
 */
export function applyOverride(
  input: CreateTaskInput,
  override: Partial<CreateTaskInput>
): CreateTaskInput {
  return { ...input, ...override };
}

/**
 * Turn a group's drop target into the quick-add seed for that section. Mirrors
 * `patchForDrop` in draggable-task-groups.tsx so "drop into" and "add into" a
 * group agree. Groups with no single mutable axis (no-date, tags) and
 * `value: null` groups ("No project") seed nothing — a plain quick-add.
 */
export function seedFromDrop(drop: GroupDropTarget | null): QuickAddSeed {
  if (!drop || drop.value === null) return {};
  switch (drop.field) {
    case "status":
      return { status: drop.value as TaskStatus };
    case "priority":
      return { priority: drop.value as TaskPriority };
    case "project_id":
      return { project_id: drop.value };
    case "when_date":
      return { when_date: drop.value };
  }
}

/**
 * Seed for an Upcoming date column. A real `YYYY-MM-DD` seeds `when_date`; the
 * "unscheduled" sentinel (or anything not date-shaped) seeds nothing.
 */
export function seedFromUpcomingDate(date: string): QuickAddSeed {
  return ISO_DATE.test(date) ? { when_date: date } : {};
}
