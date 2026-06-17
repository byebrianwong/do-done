"use client";

import { addDaysLocalISO, isManualSort, todayLocalISO, type Project, type Task } from "@do-done/shared";
import { taskDate } from "@do-done/api-client";
import { CuratedDisplayView } from "./curated-display-view";
import { DraggableUpcoming } from "./draggable-upcoming-client";
import { NO_DATE_KEY } from "./draggable-upcoming";

function formatDayHeading(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return "Today";
  if (date.getTime() === tomorrow.getTime()) return "Tomorrow";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Per-day columns: a "No date" inbox, the next 14 days as drop targets, then
 *  any further-out days that have tasks. when_date wins over due_date. */
function buildDateGroups(
  tasks: Task[]
): { date: string; label: string; tasks: Task[]; emptyHint?: string }[] {
  // The browser's local day is the authority on "today". getUpcoming fetches
  // a one-day skew buffer (its lower bound is server-today − 1), so any dated
  // row before local today is genuinely overdue — it belongs in Today, not
  // here. Drop it rather than spill a stray trailing day-group.
  const today = todayLocalISO();
  const undated: Task[] = [];
  const byDate = new Map<string, Task[]>();
  for (const t of tasks) {
    const d = taskDate(t);
    if (!d) {
      undated.push(t);
      continue;
    }
    if (d < today) continue;
    const list = byDate.get(d) ?? [];
    list.push(t);
    byDate.set(d, list);
  }

  const groups: { date: string; label: string; tasks: Task[]; emptyHint?: string }[] = [
    {
      date: NO_DATE_KEY,
      label: "No date",
      tasks: undated,
      emptyHint: "Nothing unscheduled — drag here to clear a date",
    },
  ];
  for (let i = 0; i < 14; i++) {
    // Local YYYY-MM-DD so the column keys match the local-date basis the API
    // (getUpcoming) and the chips (formatDueDate) use. toISOString() here was
    // UTC and shifted the columns by a day for positive-offset zones.
    const key = addDaysLocalISO(i);
    groups.push({ date: key, label: formatDayHeading(key), tasks: byDate.get(key) ?? [] });
    byDate.delete(key);
  }
  const remaining = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [date, dayTasks] of remaining) {
    groups.push({ date, label: formatDayHeading(date), tasks: dayTasks });
  }
  return groups;
}

export function UpcomingView({
  allTasks,
  projects,
  beforeContent,
}: {
  allTasks: Task[];
  projects: Project[];
  beforeContent?: React.ReactNode;
}) {
  return (
    <CuratedDisplayView
      viewKey="upcoming"
      title="Upcoming"
      allTasks={allTasks}
      projects={projects}
      beforeContent={beforeContent}
      curatedWhen={(c) => c.group === "date" && isManualSort(c)}
      renderCurated={(tasks) => {
        const groups = buildDateGroups(tasks);
        const hasAny = groups.some((g) => g.tasks.length > 0);
        return hasAny ? (
          <DraggableUpcoming groups={groups} projects={projects} />
        ) : (
          <div className="py-16 text-center">
            <p className="text-sm text-neutral-400">
              No upcoming tasks. Schedule one to see it here.
            </p>
          </div>
        );
      }}
    />
  );
}
