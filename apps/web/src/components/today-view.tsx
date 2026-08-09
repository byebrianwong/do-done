"use client";

import { useEffect, useMemo, useState } from "react";
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
  // Render only after mount: "today" is the VIEWER's local day, which can
  // differ from the server's during SSR (UTC host, evening in the Americas) —
  // rendering server-side would flash the wrong day's events and trip a
  // hydration mismatch. Recomputed every render (cheap — a few events) so an
  // overnight tab picks up the new day on its next interaction.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const todayEvents = calendarEventsOnDay(events, todayLocalISO());
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
          {/* Scheduled for today, because that is what this screen is: an
              undated task typed here vanishes from the list it was typed into.
              The Date chip shows it and a typed date overrules it, so it's a
              default rather than a decision. No status seed, though — Today
              isn't a status axis, so the task takes the default, inbox. */}
          <QuickAddBar seed={{ scheduled_date: todayLocalISO() }} />
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
