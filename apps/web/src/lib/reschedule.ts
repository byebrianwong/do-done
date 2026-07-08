import type { Task, UpdateTaskInput } from "@do-done/shared";

/** Where a reschedule sends a task: onto a concrete day, or dates cleared. */
export type RescheduleTarget =
  | { kind: "date"; date: string }
  | { kind: "remove" };

/**
 * Build an UpdateTaskInput that moves an overdue task to a target when_date,
 * sliding any past due_date forward to keep the deadline plausible. Shared by
 * the Today Overdue section and the Upcoming Overdue group so both reschedule
 * with identical semantics.
 */
export function buildRescheduleInput(
  task: Task,
  target: RescheduleTarget
): UpdateTaskInput {
  if (target.kind === "remove") {
    return {
      when_date: null,
      due_date: null,
      due_time: null,
    };
  }
  const input: UpdateTaskInput = { when_date: target.date };
  if (task.due_date && task.due_date < target.date) {
    input.due_date = target.date;
  }
  return input;
}
