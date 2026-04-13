import type { Task } from "@do-done/shared";
import { FOCUS_SCORES, PRIORITY_CONFIG } from "@do-done/shared";
import { isOverdue, isDueToday } from "@do-done/shared";

function scoreTask(task: Task): number {
  let score = 0;

  if (isOverdue(task)) score += FOCUS_SCORES.OVERDUE;
  if (isDueToday(task)) score += FOCUS_SCORES.DUE_TODAY;
  if (task.status === "in_progress") score += FOCUS_SCORES.IN_PROGRESS;
  if (task.due_time) score += FOCUS_SCORES.HAS_TIME_BLOCK;

  score += PRIORITY_CONFIG[task.priority].score;

  return score;
}

export function generateFocusList(
  tasks: Task[],
  maxItems: number = 7
): Task[] {
  const activeTasks = tasks.filter(
    (t) => t.status !== "done" && t.status !== "archived"
  );

  return activeTasks
    .map((task) => ({ task, score: scoreTask(task) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems)
    .map(({ task }) => task);
}
