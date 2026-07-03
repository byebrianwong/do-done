"use client";

import { useMemo } from "react";
import {
  calendarEventsOnDay,
  isManualSort,
  toggleCollapsed,
  todayLocalISO,
  type CalendarEvent,
  type Project,
  type Task,
} from "@do-done/shared";
import { todayUniverse } from "@do-done/task-engine";
import { CuratedDisplayView } from "./curated-display-view";
import { DraggableToday } from "./draggable-today-client";
import { QuickAddBar } from "./quick-add-bar";
import { CalendarEventRow } from "./calendar-event-item";

/** Today's Google Calendar events — the fixed skeleton of the day, shown
 *  above the task list so tasks can be planned around them. */
function TodaySchedule({ events }: { events: CalendarEvent[] }) {
  // Re-filter to the VIEWER's today: the server fetched a padded range, and
  // its "today" may differ from the browser's near midnight.
  const todayEvents = useMemo(
    () => calendarEventsOnDay(events, todayLocalISO()),
    [events]
  );
  if (todayEvents.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-neutral-200 bg-white py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="px-3 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Today&rsquo;s schedule
      </div>
      {todayEvents.map((e) => (
        <CalendarEventRow key={e.id} event={e} />
      ))}
    </div>
  );
}

export function TodayView({
  allTasks,
  projects,
  events = [],
}: {
  allTasks: Task[];
  projects: Project[];
  /** Google Calendar events overlapping today (read-only). */
  events?: CalendarEvent[];
}) {
  // The set of tasks that belong on Today: overdue, the focus picks (which now
  // include any task the user has pinned in), and anything scheduled for today.
  // This is the universe the Display menu groups/sorts/filters over.
  const universe = useMemo(
    () => todayUniverse(allTasks, todayLocalISO()),
    [allTasks]
  );

  return (
    <CuratedDisplayView
      viewKey="today"
      title="Today"
      allTasks={universe}
      projects={projects}
      beforeContent={
        <>
          <TodaySchedule events={events} />
          <QuickAddBar seed={{ status: "not_started" }} />
        </>
      }
      curatedWhen={(c) => c.group === "none" && isManualSort(c)}
      renderCurated={(tasks, config, onConfigChange) => (
        <DraggableToday
          tasks={tasks}
          projects={projects}
          collapsed={config.collapsed}
          onToggleCollapse={(key) => onConfigChange(toggleCollapsed(config, key))}
        />
      )}
    />
  );
}
