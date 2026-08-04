import type { CreateTaskInput, Task } from "@do-done/shared";

/**
 * Build a `CreateTaskInput` from an existing task, dropping null/empty fields
 * (the create schema is `.optional()`, not `.nullable()`). Used by Duplicate
 * and by the delete undo paths (single + bulk), which recreate the task.
 */
export function toCreateInput(t: Task, title: string): CreateTaskInput {
  const input: CreateTaskInput = { title, priority: t.priority };
  if (t.description) input.description = t.description;
  if (t.status) input.status = t.status;
  if (t.project_id) input.project_id = t.project_id;
  if (t.scheduled_date) input.scheduled_date = t.scheduled_date;
  if (t.scheduled_time) input.scheduled_time = t.scheduled_time;
  if (t.deadline_date) input.deadline_date = t.deadline_date;
  if (t.deadline_time) input.deadline_time = t.deadline_time;
  if (t.duration_minutes) input.duration_minutes = t.duration_minutes;
  if (t.recurrence_rule) input.recurrence_rule = t.recurrence_rule;
  if (t.tags.length) input.tags = t.tags;
  if (t.parent_task_id) input.parent_task_id = t.parent_task_id;
  return input;
}
