import { UpdateTaskInput } from "./schemas.js";

/**
 * Validating a task patch *before* it is sent, field by field.
 *
 * The editors autosave a diff. When one field in that diff is something the
 * database won't accept, the whole PATCH is rejected — and because the autosave
 * hook keeps diffing against state the server never took, the bad field rides
 * along in every subsequent write. One over-long note stopped the user's title,
 * priority and date edits from saving too, and the only signal was a red dot.
 *
 * Checking locally turns that into something the editor can act on: the bad
 * field is named, its neighbours still save, and the message says what to do
 * instead of quoting a constraint name. This works only because the Zod schemas
 * and the DB CHECK constraints are kept deliberately in step (see
 * TASK_DESCRIPTION_MAX_LENGTH) — a patch that passes here passes there.
 *
 * Fields are validated one at a time rather than as a whole object. A patch is
 * a partial by construction, and `UpdateTaskInput` carries no cross-field
 * refinements, so per-key parsing loses nothing and is what lets a good field
 * through while a bad one is held back.
 */

/** Field name → a message safe to show the user. */
export type FieldErrors = Record<string, string>;

/** How each field is named when we have to talk to the user about it. */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Notes",
  status: "Status",
  priority: "Priority",
  project_id: "Project",
  scheduled_date: "Scheduled date",
  scheduled_time: "Scheduled time",
  deadline_date: "Deadline date",
  deadline_time: "Deadline time",
  duration_minutes: "Estimate",
  recurrence_rule: "Repeat",
  tags: "Tags",
  parent_task_id: "Parent task",
  focus_override: "Focus",
};

/** The bits of a Zod issue we read, kept structural so this stays cheap. */
type ParseIssue = {
  code?: string;
  type?: string;
  maximum?: number | bigint | null;
  minimum?: number | bigint | null;
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/**
 * Turn a Zod issue into something worth showing someone mid-edit.
 *
 * Zod's own wording ("String must contain at most 50000 character(s)") is
 * accurate and useless in a task editor, so the cases a user can actually
 * provoke by typing get their own copy. Everything else falls back to naming
 * the field, which at least points at what to fix.
 */
function describeIssue(field: string, issue: ParseIssue | undefined): string {
  const label = fieldLabel(field);
  if (issue?.code === "too_big" && issue.type === "string") {
    const max = Number(issue.maximum ?? 0);
    return `${label} is too long — ${max.toLocaleString()} characters max.`;
  }
  if (issue?.code === "too_small" && issue.type === "string") {
    return `${label} can't be empty.`;
  }
  return `${label} isn't valid.`;
}

/**
 * Split a task patch into the fields that will be accepted and the ones that
 * won't, with a message for each rejection.
 *
 * Unknown keys pass through untouched: `UpdateTaskInput` ignores keys it
 * doesn't declare, and silently dropping a field the caller asked to write
 * would be a worse failure than letting the server refuse it.
 */
export function partitionTaskPatch(patch: Record<string, unknown>): {
  valid: Record<string, unknown>;
  invalid: FieldErrors;
} {
  const valid: Record<string, unknown> = {};
  const invalid: FieldErrors = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in UpdateTaskInput.shape)) {
      valid[key] = value;
      continue;
    }
    const result = UpdateTaskInput.safeParse({ [key]: value });
    if (result.success) {
      valid[key] = value;
    } else {
      invalid[key] = describeIssue(key, result.error.issues[0] as ParseIssue);
    }
  }
  return { valid, invalid };
}

/**
 * One line summarising a set of field errors, for a status indicator that has
 * room for a sentence rather than a list.
 */
export function summarizeFieldErrors(errors: FieldErrors): string | null {
  const keys = Object.keys(errors);
  if (keys.length === 0) return null;
  if (keys.length === 1) return errors[keys[0]];
  return `${keys.map(fieldLabel).join(", ")} couldn't be saved.`;
}
