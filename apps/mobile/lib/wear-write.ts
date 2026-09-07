/**
 * Applying a write the watch sent.
 *
 * The watch relays a write here rather than making it itself whenever the phone
 * is in range, because this is the side that has `TasksApi` — the one door web,
 * mobile and MCP all write through. A completion relayed here stamps
 * `completed_at`, feeds the pet and records a shopping item in the pantry; the
 * same completion made directly by the watch, out of range, does only the first.
 *
 * A create is *only* ever done here. `parseTaskInput` is what turns "call the
 * bank tomorrow" into a task scheduled tomorrow, and it is several hundred lines
 * of TypeScript. A watch that guessed at it would file dictated tasks undated,
 * which is worse than one that waits.
 */

import { parseTaskInput } from '@do-done/task-engine';
import type { CreateTaskInput, Project } from '@do-done/shared';

/** The ops the watch can send. Mirrors `PendingWrites.Entry` on the watch. */
export type WearWriteOp = 'complete' | 'reschedule' | 'create';

export interface WearWrite {
  op: WearWriteOp;
  /** Empty for a create — the row does not exist yet. */
  taskId: string;
  /** The create's text, or the reschedule's `YYYY-MM-DD`. Empty otherwise. */
  value: string;
}

/**
 * Read what the watch sent.
 *
 * Returns null for anything unrecognised rather than throwing. The watch APK
 * does not ship over OTA, so a watch running *ahead* of the phone's bundle — an
 * older phone bundle meeting a newer watch — is a real state, and it must degrade
 * to "the write is ignored and the snapshot still goes back" rather than to a
 * crashed background task that also skips the sync.
 */
export function parseWearWrite(raw: unknown): WearWrite | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { op, taskId, value } = parsed as Record<string, unknown>;
  if (op !== 'complete' && op !== 'reschedule' && op !== 'create') return null;
  const id = typeof taskId === 'string' ? taskId : '';
  const text = typeof value === 'string' ? value : '';

  // A write naming nothing to write to is not a write. Dropping it here is what
  // stops an empty create landing as a task called "".
  if (op === 'create' ? text.trim() === '' : id === '') return null;
  if (op === 'reschedule' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  return { op, taskId: id, value: text };
}

/**
 * Turn dictated text into a task.
 *
 * **No status.** The watch has no view context to infer one from — the same
 * reasoning as the quick-add widget, the launcher shortcut and `dodone://quick-add`
 * — so the task inherits the `inbox` default and shows up in the triage nobody
 * would otherwise know to look for it in. Capture is not triage.
 */
export function wearCreateInput(
  text: string,
  projects: Project[]
): CreateTaskInput {
  const trimmed = text.trim();
  const parsed = parseTaskInput(trimmed, undefined, { projects });
  return {
    title: parsed.title || trimmed,
    ...(parsed.project_id && { project_id: parsed.project_id }),
    ...(parsed.priority && { priority: parsed.priority }),
    ...(parsed.scheduled_date && { scheduled_date: parsed.scheduled_date }),
    // Only meaningful alongside a date, which the parser guarantees whenever it
    // produced a time.
    ...(parsed.scheduled_time && { scheduled_time: parsed.scheduled_time }),
    ...(parsed.deadline_date && { deadline_date: parsed.deadline_date }),
    ...(parsed.deadline_time && { deadline_time: parsed.deadline_time }),
    ...(parsed.duration_minutes && { duration_minutes: parsed.duration_minutes }),
    ...(parsed.tags?.length ? { tags: parsed.tags } : {}),
    ...(parsed.recurrence_rule && { recurrence_rule: parsed.recurrence_rule }),
  };
}
