import { parseTaskInput } from "@do-done/task-engine";
import { todayLocalISO } from "@do-done/shared";
import type {
  CreateTaskInput,
  GroupDropTarget,
  ParsedTask,
  ProjectRef,
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
  Pick<CreateTaskInput, "status" | "priority" | "project_id" | "scheduled_date">
>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a natural-language quick-add string and layer the section's seed on top
 * to produce the `CreateTaskInput` for `TasksApi.create`.
 *
 * Precedence — what the user typed beats what the surface guessed, on every
 * axis the text can address:
 *  - title       ← parsed only
 *  - status      ← seed wins when set, else default (the parser never sets it)
 *  - priority    ← parsed wins over seed
 *  - project_id  ← parsed wins when a typed `#name` matched, else seed
 *  - scheduled_date   ← parsed wins over seed
 *  - tags / deadline_* / duration / recurrence ← parsed only
 *
 * Every seeded axis except `status` is also *shown*, pre-filled into the
 * quick-add chips (see {@link contextFacets}), so a guess the text overrules is
 * visible before the task is created rather than a silent swap at submit.
 *
 * A `#name` or `/name` that matches one of `projects` resolves to a real
 * `project_id` and beats the section's, on the same rule as priority: naming a
 * project is deliberate. `parsed.project` on its own is only a *name* (a
 * `/typo` matching nothing), so it stays dropped — the chips set `project_id`.
 */
export function buildCreateInput(
  raw: string,
  seed: QuickAddSeed = {},
  referenceDate?: Date,
  projects?: readonly ProjectRef[]
): CreateTaskInput {
  const parsed = parseTaskInput(raw, referenceDate, { projects });

  const input: CreateTaskInput = {
    title: parsed.title,
    ...(parsed.priority && { priority: parsed.priority }),
    ...(parsed.scheduled_date && { scheduled_date: parsed.scheduled_date }),
    ...(parsed.scheduled_time && { scheduled_time: parsed.scheduled_time }),
    ...(parsed.deadline_date && { deadline_date: parsed.deadline_date }),
    ...(parsed.deadline_time && { deadline_time: parsed.deadline_time }),
    ...(parsed.project_id && { project_id: parsed.project_id }),
    ...(parsed.duration_minutes && { duration_minutes: parsed.duration_minutes }),
    ...(parsed.tags && parsed.tags.length > 0 && { tags: parsed.tags }),
    ...(parsed.recurrence_rule && { recurrence_rule: parsed.recurrence_rule }),
  };

  // Section axis wins for status (parser never sets it).
  if (seed.status) input.status = seed.status;

  // Typed priority wins; otherwise inherit the section's priority.
  if (!input.priority && seed.priority) input.priority = seed.priority;

  // A typed `#project` wins; otherwise inherit the section's project.
  if (!input.project_id && seed.project_id) input.project_id = seed.project_id;

  // A typed date wins; otherwise inherit the section's date.
  if (!input.scheduled_date && seed.scheduled_date)
    input.scheduled_date = seed.scheduled_date;

  return input;
}

/**
 * The facet values a surface's chips should show before the user has touched
 * them: exactly what {@link buildCreateInput} would create the task with, given
 * the section seed and the live parse of what's been typed so far. Keeping the
 * two in one file — and asserting they agree in `quick-add.test.ts` — is what
 * stops a chip claiming one thing while the create does another.
 *
 * `duration_minutes` has no seed; it's here because the chip row shows it and
 * `ParsedPreview` omits it, so the parse is otherwise invisible.
 */
export interface QuickAddFacets {
  priority: TaskPriority | null;
  project_id: string | null;
  scheduled_date: string | null;
  duration_minutes: number | null;
}

export function contextFacets(
  seed: QuickAddSeed,
  parsed: ParsedTask | null
): QuickAddFacets {
  return {
    priority: parsed?.priority ?? seed.priority ?? null,
    project_id: parsed?.project_id ?? seed.project_id ?? null,
    scheduled_date: parsed?.scheduled_date ?? seed.scheduled_date ?? null,
    duration_minutes: parsed?.duration_minutes ?? null,
  };
}

/**
 * An explicit chip pick, layered over a built input. A value wins over both the
 * parsed text and the section seed, since picking a chip is a deliberate act;
 * `null` *clears* the field, which is the only way to say "not in this project"
 * on a surface whose seed would otherwise put it there.
 */
export type QuickAddOverride = {
  [K in keyof CreateTaskInput]?: CreateTaskInput[K] | null;
};

export function applyOverride(
  input: CreateTaskInput,
  override: QuickAddOverride
): CreateTaskInput {
  const out: Record<string, unknown> = { ...input };
  for (const [key, value] of Object.entries(override)) {
    if (value == null) delete out[key];
    else out[key] = value;
  }
  return out as CreateTaskInput;
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
    case "scheduled_date":
      return { scheduled_date: drop.value };
  }
}

/**
 * Seed for an Upcoming date column. A real `YYYY-MM-DD` seeds `scheduled_date`; the
 * "unscheduled" sentinel (or anything not date-shaped) seeds nothing.
 */
export function seedFromUpcomingDate(date: string): QuickAddSeed {
  return ISO_DATE.test(date) ? { scheduled_date: date } : {};
}

/**
 * The seed a *page* implies, for the universal quick-add (the sidebar button,
 * the palette, `q`) — which is opened from wherever the user already is, and so
 * has the same context the page's own bar does. Only routes whose whole subject
 * is one facet qualify: a project page files into that project, Today schedules
 * for today, the Inbox is the one place capture and triage coincide. Everything
 * else (Upcoming, All, a task page) guesses nothing.
 *
 * Matches the `/demo` mirror of each route too, so the sandbox behaves like the
 * app it's demonstrating.
 */
export function seedFromPathname(pathname: string | null): QuickAddSeed {
  if (!pathname) return {};
  const inProject = /^\/(?:demo\/)?projects\/([^/]+)\/?$/.exec(pathname);
  if (inProject) return { status: "not_started", project_id: inProject[1] };
  if (/^\/(?:demo\/)?inbox\/?$/.test(pathname)) return { status: "inbox" };
  if (/^\/(?:demo\/)?today\/?$/.test(pathname))
    return { scheduled_date: todayLocalISO() };
  return {};
}
