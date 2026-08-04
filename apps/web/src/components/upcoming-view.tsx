"use client";

import {
  addDaysLocalISO,
  groupCalendarEventsByDay,
  isManualSort,
  isOverdue,
  toggleCollapsed,
  type CalendarEvent,
  type Project,
  type Task,
} from "@do-done/shared";
import { taskDate } from "@do-done/api-client";
import { CuratedDisplayView } from "./curated-display-view";
import { DraggableUpcoming } from "./draggable-upcoming-client";
import {
  NO_DATE_KEY,
  OVERDUE_KEY,
  type UpcomingDateGroup,
} from "./draggable-upcoming";

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

/** Per-day columns: an "Overdue" bucket (when present), a "No date" inbox, the
 *  next 14 days as drop targets, then any further-out days that have tasks.
 *  scheduled_date wins over deadline_date. */
function buildDateGroups(
  tasks: Task[],
  events: CalendarEvent[]
): UpcomingDateGroup[] {
  // The browser's local day is the authority on "today". Anything scheduled or
  // due strictly before it is overdue and gets its own section at the top —
  // mirroring the mobile Upcoming screen. (isOverdue is the canonical, shared
  // definition: scheduled_date OR deadline_date < today, excluding closed tasks.)
  const overdue: Task[] = [];
  const undated: Task[] = [];
  const byDate = new Map<string, Task[]>();
  for (const t of tasks) {
    if (isOverdue(t)) {
      overdue.push(t);
      continue;
    }
    const d = taskDate(t);
    if (!d) {
      undated.push(t);
      continue;
    }
    const list = byDate.get(d) ?? [];
    list.push(t);
    byDate.set(d, list);
  }

  // One bucketing pass instead of a per-column scan of the whole events array.
  const eventsByDay = groupCalendarEventsByDay(events);

  const groups: UpcomingDateGroup[] = [];
  if (overdue.length > 0) {
    groups.push({ date: OVERDUE_KEY, label: "Overdue", tasks: overdue });
  }
  groups.push({
    date: NO_DATE_KEY,
    label: "No date",
    tasks: undated,
    emptyHint: "Nothing unscheduled — drag here to clear a date",
  });
  for (let i = 0; i < 14; i++) {
    // Local YYYY-MM-DD so the column keys match the local-date basis the API
    // (getUpcoming) and the chips (formatTaskDate) use. toISOString() here was
    // UTC and shifted the columns by a day for positive-offset zones.
    const key = addDaysLocalISO(i);
    groups.push({
      date: key,
      label: formatDayHeading(key),
      tasks: byDate.get(key) ?? [],
      events: eventsByDay.get(key) ?? [],
    });
    byDate.delete(key);
  }
  // Beyond the fixed 14 days, a day earns a column if it has tasks OR events —
  // an event-only day 3 weeks out would otherwise be fetched but never shown.
  // (Days before today can appear in eventsByDay from the fetch padding; only
  // future days get event columns.)
  const lastFixedDay = addDaysLocalISO(13);
  const extraDays = new Set(byDate.keys());
  for (const day of eventsByDay.keys()) {
    if (day > lastFixedDay) extraDays.add(day);
  }
  for (const date of [...extraDays].sort()) {
    groups.push({
      date,
      label: formatDayHeading(date),
      tasks: byDate.get(date) ?? [],
      events: eventsByDay.get(date) ?? [],
    });
  }
  return groups;
}

export function UpcomingView({
  allTasks,
  projects,
  events = [],
  beforeContent,
}: {
  allTasks: Task[];
  projects: Project[];
  /** Google Calendar events for the visible horizon (read-only). */
  events?: CalendarEvent[];
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
      renderCurated={(tasks, config, onConfigChange) => {
        const groups = buildDateGroups(tasks, events);
        const hasAny = groups.some(
          (g) => g.tasks.length > 0 || (g.events?.length ?? 0) > 0
        );
        return hasAny ? (
          <DraggableUpcoming
            groups={groups}
            projects={projects}
            collapsed={config.collapsed}
            onToggleCollapse={(key) => onConfigChange(toggleCollapsed(config, key))}
          />
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
