import type { Task, WeeklySummary, TaskPriority } from "@do-done/shared";

export function generateWeeklySummary(
  tasks: Task[],
  weekStart?: Date
): WeeklySummary {
  const start = weekStart ?? getWeekStart();
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const startStr = start.toISOString();
  const endStr = end.toISOString();

  const completedThisWeek = tasks.filter(
    (t) => t.completed_at && t.completed_at >= startStr && t.completed_at < endStr
  );

  const createdThisWeek = tasks.filter(
    (t) => t.created_at >= startStr && t.created_at < endStr
  );

  const overdue = tasks.filter(
    (t) =>
      t.due_date &&
      t.due_date < new Date().toISOString().split("T")[0] &&
      t.status !== "done" &&
      t.status !== "archived"
  );

  // Priority distribution of completed tasks
  const priorityDist = { p1: 0, p2: 0, p3: 0, p4: 0 } as Record<TaskPriority, number>;
  for (const t of completedThisWeek) {
    priorityDist[t.priority]++;
  }

  // Most productive day
  const dayCount: Record<string, number> = {};
  for (const t of completedThisWeek) {
    if (t.completed_at) {
      const day = new Date(t.completed_at).toLocaleDateString("en-US", { weekday: "long" });
      dayCount[day] = (dayCount[day] ?? 0) + 1;
    }
  }
  const mostProductiveDay =
    Object.entries(dayCount).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  // Top projects
  const projectCount: Record<string, number> = {};
  for (const t of completedThisWeek) {
    if (t.project_id) {
      projectCount[t.project_id] = (projectCount[t.project_id] ?? 0) + 1;
    }
  }
  const topProjects = Object.entries(projectCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, completed]) => ({ name, completed }));

  const completionRate =
    createdThisWeek.length > 0
      ? completedThisWeek.length / createdThisWeek.length
      : 0;

  return {
    completed_count: completedThisWeek.length,
    created_count: createdThisWeek.length,
    completion_rate: Math.round(completionRate * 100) / 100,
    overdue_count: overdue.length,
    most_productive_day: mostProductiveDay,
    priority_distribution: priorityDist,
    top_projects: topProjects,
  };
}

function getWeekStart(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
