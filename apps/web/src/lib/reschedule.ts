import type { Task, UpdateTaskInput } from "@do-done/shared";

/** Where a reschedule sends a task: onto a concrete day, or dates cleared. */
export type RescheduleTarget =
  | { kind: "date"; date: string }
  | { kind: "remove" };

/**
 * Build an UpdateTaskInput that moves an overdue task to a target scheduled_date,
 * sliding any past deadline_date forward to keep the deadline plausible. Shared by
 * the Today Overdue section and the Upcoming Overdue group so both reschedule
 * with identical semantics.
 */
export function buildRescheduleInput(
  task: Task,
  target: RescheduleTarget
): UpdateTaskInput {
  if (target.kind === "remove") {
    return {
      scheduled_date: null,
      deadline_date: null,
      deadline_time: null,
    };
  }
  const input: UpdateTaskInput = { scheduled_date: target.date };
  if (task.deadline_date && task.deadline_date < target.date) {
    input.deadline_date = target.date;
  }
  return input;
}
