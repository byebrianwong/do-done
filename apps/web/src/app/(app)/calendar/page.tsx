import { read } from "@/lib/read-result";
import { requireServerApis } from "@/lib/supabase/tasks-server";
import { WeekView } from "@/components/week-view-client";
import { getDisplayEvents } from "@/lib/calendar-events";
import { taskDate } from "@do-done/api-client";
import { todayLocalISO } from "@do-done/shared";

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

  const { tasksApi, projectsApi } = await requireServerApis();

  // Local YYYY-MM-DD so the range matches the local scheduled_date the user set
  // (toISOString() would be UTC and shift the boundaries by a day).
  const startStr = todayLocalISO(weekStart);
  const endStr = todayLocalISO(weekEnd);

  // The list() helper filters by deadline_date only — that's too narrow for the
  // calendar because most tasks use scheduled_date (the Things-style "do date").
  // Fetch the full active set and filter by effective date client-side.
  const [allTasks, projects, events] = await Promise.all([
    read(tasksApi.list({ limit: 200, offset: 0 }), "your tasks"),
    read(projectsApi.list(), "your projects"),
    // Not a `read` — see today/page.tsx.
    getDisplayEvents(startStr, endStr),
  ]);

  const tasks = allTasks.filter((t) => {
    const d = taskDate(t);
    return d !== null && d >= startStr && d < endStr;
  });

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Calendar
      </h1>
      <WeekView
        weekStart={startStr}
        tasks={tasks}
        projects={projects}
        events={events}
      />
    </div>
  );
}
