"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { todayLocalISO } from "@do-done/shared";
import { taskDate } from "@do-done/api-client";
import { WeekView } from "@/components/week-view-client";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

/** Monday-start week containing `date`. Mirrors the real calendar page. */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function DemoCalendarPage() {
  return (
    <Suspense fallback={<DemoLoading />}>
      <DemoCalendar />
    </Suspense>
  );
}

function DemoCalendar() {
  const { tasks, projects, events, ready } = useDemoData();
  // `?week=` is how WeekView pages backwards and forwards.
  const weekParam = useSearchParams().get("week");
  if (!ready) return <DemoLoading />;

  const weekStart = getWeekStart(
    weekParam ? new Date(`${weekParam}T00:00:00`) : new Date()
  );
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const startStr = todayLocalISO(weekStart);
  const endStr = todayLocalISO(weekEnd);

  const inWeek = tasks.filter((t) => {
    const d = taskDate(t);
    return d !== null && d >= startStr && d < endStr;
  });
  const weekEvents = events.filter((e) => {
    const d = (e.start ?? e.start_date ?? "").slice(0, 10);
    return d >= startStr && d < endStr;
  });

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Calendar
      </h1>
      <WeekView
        weekStart={startStr}
        tasks={inWeek}
        projects={projects}
        events={weekEvents}
      />
    </div>
  );
}
