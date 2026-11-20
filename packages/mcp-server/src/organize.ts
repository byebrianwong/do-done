import type { TasksApi } from "@do-done/api-client";
import type {
  Task,
  TaskPriority,
  TaskStatus,
} from "@do-done/shared";
import { isActiveTask, isOverdueOn } from "./dates.js";

type Action =
  | { kind: "archive" }
  | { kind: "complete" }
  | { kind: "set_priority"; priority: TaskPriority }
  | { kind: "set_status"; status: TaskStatus };

interface Filter {
  /**
   * Omitted means open tasks. Done and cancelled tasks are only matched when
   * the instruction names them ("archive done tasks older than 30 days"): with
   * no status word, "archive all p4 tasks" would otherwise turn every finished
   * p4 task in the account into a cancelled one.
   */
  status?: TaskStatus | "overdue";
  priority?: TaskPriority;
  olderThanDays?: number;
}

interface ParsedInstruction {
  action: Action;
  filter: Filter;
}

const PRIORITY_RE = /\b(p[1-4])\b/i;
const OLDER_THAN_RE = /\bolder\s+than\s+(\d+)\s+days?\b/i;

function parseInstruction(text: string): ParsedInstruction | null {
  const lower = text.toLowerCase();

  // Determine action
  let action: Action | null = null;
  const setPriorityMatch = /\bset\s+(?:.*?\s+)?to\s+(p[1-4])\b/i.exec(text);
  if (setPriorityMatch) {
    action = {
      kind: "set_priority",
      priority: setPriorityMatch[1].toLowerCase() as TaskPriority,
    };
  } else if (/\barchive\b/.test(lower)) {
    action = { kind: "archive" };
  } else if (/\b(complete|finish|mark\s+done)\b/.test(lower)) {
    action = { kind: "complete" };
  } else if (/\bmove\s+(?:.*?\s+)?to\s+inbox\b/.test(lower)) {
    action = { kind: "set_status", status: "inbox" };
  } else if (
    /\bmove\s+(?:.*?\s+)?to\s+later\b/.test(lower) ||
    /\b(?:defer|snooze)\b/.test(lower)
  ) {
    action = { kind: "set_status", status: "later" };
  }

  if (!action) return null;

  // Determine filter
  const filter: Filter = {};
  if (/\bdone\b|\bcompleted\b/.test(lower)) filter.status = "done";
  else if (/\binbox\b/.test(lower)) filter.status = "inbox";
  else if (/\barchived\b|\bcancelled\b|\bcanceled\b/.test(lower))
    filter.status = "cancelled";
  else if (/\boverdue\b/.test(lower)) filter.status = "overdue";

  const priorityMatch = PRIORITY_RE.exec(text);
  // If the instruction is "set ... to pX", that pX is the action target, not filter.
  // Only use as filter if it's mentioned outside the "to pX" clause.
  if (priorityMatch && action.kind !== "set_priority") {
    filter.priority = priorityMatch[1].toLowerCase() as TaskPriority;
  } else if (priorityMatch && action.kind === "set_priority") {
    // Look for a SECOND priority mention as the filter
    const rest = text.replace(/\bto\s+p[1-4]\b/i, "");
    const filterMatch = PRIORITY_RE.exec(rest);
    if (filterMatch) {
      filter.priority = filterMatch[1].toLowerCase() as TaskPriority;
    }
  }

  const olderMatch = OLDER_THAN_RE.exec(text);
  if (olderMatch) {
    filter.olderThanDays = parseInt(olderMatch[1], 10);
  }

  return { action, filter };
}

/**
 * Whether a task matches the parsed filter.
 *
 * "Overdue" is the app's own rule (`isOverdue` in @do-done/shared): open, with
 * a `scheduled_date` or a `deadline_date` before today. `isOverdueOn` is that
 * rule with the day passed in, so "today" is the user's day rather than the
 * process clock's, which is UTC on the hosted transport. This used to look at
 * `deadline_date` alone, and DoDone rarely sets one, so "set all overdue to
 * p1" matched almost nothing in the Overdue section the user was looking at.
 */
function matchesFilter(task: Task, filter: Filter, todayISO: string): boolean {
  if (filter.status === "overdue") {
    if (!isOverdueOn(task, todayISO)) return false;
  } else if (filter.status) {
    if (task.status !== filter.status) return false;
  } else if (!isActiveTask(task)) {
    return false;
  }
  if (filter.priority && task.priority !== filter.priority) return false;
  if (filter.olderThanDays !== undefined) {
    const cutoff = Date.now() - filter.olderThanDays * 24 * 60 * 60 * 1000;
    const timestamp = task.completed_at
      ? new Date(task.completed_at).getTime()
      : new Date(task.created_at).getTime();
    if (timestamp >= cutoff) return false;
  }
  return true;
}

/** Every status a task can be worked on in. "Overdue" is drawn from these. */
const OPEN_STATUSES: readonly TaskStatus[] = [
  "inbox",
  "later",
  "not_started",
  "next",
  "in_progress",
];

/**
 * Rows per `list()` call. Under Supabase's default `max-rows` of 1000, which
 * would cap a larger page silently.
 */
export const ORGANIZE_PAGE_SIZE = 500;

/**
 * Every task that could match the filter.
 *
 * `list()` is a page, not the whole account, so this pages through it until a
 * call comes back empty. That is safe because the order is total:
 * `(sort_order, id)` with a key per task, so LIMIT/OFFSET cannot skip or
 * repeat a row between pages (see supabase/migrations/20261120000001_task_order.sql).
 * The offset advances by the rows received rather than the page size, so a
 * server that caps a page lower still reads everything.
 *
 * Status and priority are filtered by the database. One status at a time,
 * because `list()` takes one; an open-task filter reads each open status.
 * "Overdue" and "older than" are decided in memory by `matchesFilter`.
 *
 * Everything is read before anything is written. Writing while paging would
 * move rows out of the status being paged and shift the offsets.
 */
async function readCandidates(
  tasksApi: TasksApi,
  filter: Filter
): Promise<{ data: Task[]; error: Error | null }> {
  const statuses =
    filter.status && filter.status !== "overdue" ? [filter.status] : OPEN_STATUSES;
  const rows: Task[] = [];
  for (const status of statuses) {
    for (let offset = 0; ; ) {
      const { data, error } = await tasksApi.list({
        status,
        priority: filter.priority,
        limit: ORGANIZE_PAGE_SIZE,
        offset,
      });
      if (error) return { data: [], error };
      if (data.length === 0) break;
      rows.push(...data);
      offset += data.length;
    }
  }
  return { data: rows, error: null };
}

export interface OrganizeResult {
  matched: number;
  applied: number;
  errors: string[];
  preview: string[]; // first few matched task titles
}

/**
 * Parse and apply one bulk instruction.
 *
 * `todayISO` is the user's calendar day, from `createClock` (src/clock.ts).
 */
export async function executeOrganize(
  tasksApi: TasksApi,
  instruction: string,
  todayISO: string
): Promise<{ ok: true; result: OrganizeResult; parsed: ParsedInstruction } | { ok: false; error: string }> {
  const parsed = parseInstruction(instruction);
  if (!parsed) {
    return {
      ok: false,
      error:
        "Could not parse instruction. Examples: 'archive done tasks older than 30 days', 'set all overdue to p1', 'complete all p4 tasks'.",
    };
  }

  const { data: candidates, error } = await readCandidates(tasksApi, parsed.filter);
  if (error) {
    return { ok: false, error: error.message };
  }

  const matched = candidates.filter((t) =>
    matchesFilter(t, parsed.filter, todayISO)
  );
  const result: OrganizeResult = {
    matched: matched.length,
    applied: 0,
    errors: [],
    preview: matched.slice(0, 5).map((t) => t.title),
  };

  for (const task of matched) {
    try {
      const action = parsed.action;
      // Each write reports failure in `error` as well as by throwing, and an
      // unchecked `error` used to be counted as applied.
      let outcome: { error: Error | null };
      if (action.kind === "archive") {
        // No "archived" status in the schema anymore — "cancelled" is the
        // terminal non-done state, so archive maps to it.
        outcome = await tasksApi.update(task.id, { status: "cancelled" });
      } else if (action.kind === "complete") {
        outcome = await tasksApi.complete(task.id);
      } else if (action.kind === "set_priority") {
        outcome = await tasksApi.update(task.id, { priority: action.priority });
      } else {
        outcome = await tasksApi.update(task.id, { status: action.status });
      }
      if (outcome.error) {
        result.errors.push(`${task.id}: ${outcome.error.message}`);
        continue;
      }
      result.applied++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      result.errors.push(`${task.id}: ${msg}`);
    }
  }

  return { ok: true, result, parsed };
}
