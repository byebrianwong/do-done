import type { Task } from "./schemas.js";

export function isOverdue(task: Task): boolean {
  if (!task.due_date || task.status === "done" || task.status === "archived") {
    return false;
  }
  const today = new Date().toISOString().split("T")[0];
  return task.due_date < today;
}

export function isDueToday(task: Task): boolean {
  if (!task.due_date) return false;
  const today = new Date().toISOString().split("T")[0];
  return task.due_date === today;
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
