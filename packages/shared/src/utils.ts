import type { Task } from "./schemas.js";

/**
 * Today's date as YYYY-MM-DD in the runtime's LOCAL timezone.
 *
 * `when_date` / `due_date` are local calendar dates (no timezone), so "today"
 * must also be local. `new Date().toISOString()` is UTC and is off by a day in
 * the evening for negative-offset zones (and the morning for positive ones),
 * which made tasks scheduled for "today" read as overdue — or vice versa —
 * near midnight. Build the string from local getFullYear/Month/Date instead.
 */
export function todayLocalISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local YYYY-MM-DD `days` from today (negative = past). */
export function addDaysLocalISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return todayLocalISO(d);
}

export function isOverdue(task: Task): boolean {
  if (task.status === "done" || task.status === "cancelled") return false;
  const today = todayLocalISO();
  if (task.due_date && task.due_date < today) return true;
  if (task.when_date && task.when_date < today) return true;
  return false;
}

export function isDueToday(task: Task): boolean {
  if (!task.due_date) return false;
  return task.due_date === todayLocalISO();
}

export function sortByPriority(tasks: Task[]): Task[] {
  const order = { p1: 0, p2: 1, p3: 2, p4: 3 };
  return [...tasks].sort((a, b) => order[a.priority] - order[b.priority]);
}

export function sortBySortOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.sort_order - b.sort_order);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function generateSortOrder(
  existingOrders: number[],
  position: "start" | "end" = "end"
): number {
  if (existingOrders.length === 0) return 1000;
  if (position === "end") return Math.max(...existingOrders) + 1000;
  return Math.min(...existingOrders) - 1000;
}
