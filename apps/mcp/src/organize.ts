import type { TasksApi } from "@do-done/api-client";
import type {
  Task,
  TaskPriority,
  TaskStatus,
} from "@do-done/shared";

type Action =
  | { kind: "archive" }
  | { kind: "complete" }
  | { kind: "set_priority"; priority: TaskPriority }
  | { kind: "set_status"; status: TaskStatus };

interface Filter {
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
  }

  if (!action) return null;

  // Determine filter
  const filter: Filter = {};
  if (/\bdone\b|\bcompleted\b/.test(lower)) filter.status = "done";
  else if (/\binbox\b/.test(lower)) filter.status = "inbox";
  else if (/\barchived\b/.test(lower)) filter.status = "archived";
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

function matchesFilter(task: Task, filter: Filter): boolean {
  if (filter.status === "overdue") {
    if (!task.due_date) return false;
    const today = new Date().toISOString().split("T")[0];
    if (task.due_date >= today) return false;
    if (task.status === "done" || task.status === "archived") return false;
  } else if (filter.status && task.status !== filter.status) {
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

export interface OrganizeResult {
  matched: number;
  applied: number;
  errors: string[];
  preview: string[]; // first few matched task titles
}

export async function executeOrganize(
  tasksApi: TasksApi,
  instruction: string
): Promise<{ ok: true; result: OrganizeResult; parsed: ParsedInstruction } | { ok: false; error: string }> {
  const parsed = parseInstruction(instruction);
  if (!parsed) {
    return {
      ok: false,
      error:
        "Could not parse instruction. Examples: 'archive done tasks older than 30 days', 'set all overdue to p1', 'complete all p4 tasks'.",
    };
  }

  // Pull all relevant tasks. We over-fetch and filter in memory because the
  // filter set (e.g. olderThanDays based on completed_at) doesn't fit cleanly
  // into TasksApi.list filters.
  const { data: allTasks, error } = await tasksApi.list({
    limit: 100,
    offset: 0,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  const matched = allTasks.filter((t) => matchesFilter(t, parsed.filter));
  const result: OrganizeResult = {
    matched: matched.length,
    applied: 0,
    errors: [],
    preview: matched.slice(0, 5).map((t) => t.title),
  };

  for (const task of matched) {
    try {
      const action = parsed.action;
      if (action.kind === "archive") {
        await tasksApi.update(task.id, { status: "archived" });
      } else if (action.kind === "complete") {
        await tasksApi.complete(task.id);
      } else if (action.kind === "set_priority") {
        await tasksApi.update(task.id, { priority: action.priority });
      } else if (action.kind === "set_status") {
        await tasksApi.update(task.id, { status: action.status });
      }
      result.applied++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      result.errors.push(`${task.id}: ${msg}`);
    }
  }

  return { ok: true, result, parsed };
}
