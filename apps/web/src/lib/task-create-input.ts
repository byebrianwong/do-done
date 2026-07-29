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
  if (t.when_date) input.when_date = t.when_date;
  if (t.when_time) input.when_time = t.when_time;
  if (t.due_date) input.due_date = t.due_date;
  if (t.due_time) input.due_time = t.due_time;
  if (t.duration_minutes) input.duration_minutes = t.duration_minutes;
  if (t.recurrence_rule) input.recurrence_rule = t.recurrence_rule;
  if (t.tags.length) input.tags = t.tags;
  if (t.parent_task_id) input.parent_task_id = t.parent_task_id;
  return input;
}
