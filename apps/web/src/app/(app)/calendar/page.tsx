import { getServerTasksApi, getServerProjectsApi } from "@/lib/supabase/tasks-server";
import { WeekView } from "@/components/week-view";
import type { Task, Project } from "@do-done/shared";

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday-start week
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const params = await searchParams;
  const today = new Date();
  const weekStart = params.week
    ? getWeekStart(new Date(`${params.week}T00:00:00`))
    : getWeekStart(today);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const tasksApi = await getServerTasksApi();
  const projectsApi = await getServerProjectsApi();

  let tasks: Task[] = [];
  let projects: Project[] = [];
  if (tasksApi && projectsApi) {
    const startStr = weekStart.toISOString().split("T")[0];
    const endStr = weekEnd.toISOString().split("T")[0];
    const [tasksRes, projectsRes] = await Promise.all([
      tasksApi.list({
        due_after: startStr,
        due_before: endStr,
        limit: 200,
        offset: 0,
      }),
      projectsApi.list(),
    ]);
    tasks = tasksRes.data;
    projects = projectsRes.data;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Calendar
      </h1>
      <WeekView
        weekStart={weekStart.toISOString()}
        tasks={tasks}
        projects={projects}
      />
    </div>
  );
}
