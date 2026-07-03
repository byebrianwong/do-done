"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { CalendarEvent, Task, Project } from "@do-done/shared";
import {
  PRIORITY_CONFIG,
  calendarEventsOnDay,
  todayLocalISO,
} from "@do-done/shared";
import { taskDate } from "@do-done/api-client";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { EVENT_FALLBACK_COLOR, formatEventTime } from "./calendar-event-item";

interface WeekViewProps {
  weekStart: string; // local YYYY-MM-DD (Monday)
  tasks: Task[];
  projects: Project[];
  /** Google Calendar events overlapping the week (read-only overlay). */
  events?: CalendarEvent[];
}

const HOUR_START = 6;
const HOUR_END = 22; // exclusive
const HOUR_HEIGHT = 48; // px
const MIN_PER_PX = 60 / HOUR_HEIGHT;

export function WeekView({
  weekStart,
  tasks,
  projects,
  events = [],
}: WeekViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [localTasks, setLocalTasks] = useState(tasks);
  useEffect(() => setLocalTasks(tasks), [tasks]);
  // Mouse drags start after a small move (distinguishes click from drag).
  // Touch drags start after a short press so a normal swipe scrolls the
  // (horizontally scrollable) week grid instead of grabbing a task.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    })
  );

  // Parse as LOCAL midnight, not `new Date(weekStart)` — a bare YYYY-MM-DD is
  // parsed as UTC midnight, which shifts every day (and breaks the "today"
  // highlight, since the day cells would no longer sit on local midnight).
  const start = useMemo(() => new Date(`${weekStart}T00:00:00`), [weekStart]);
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [start]);

  const projectColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.color);
    return m;
  }, [projects]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const prevWeekHref = (() => {
    const d = new Date(start);
    d.setDate(d.getDate() - 7);
    return `/calendar?week=${todayLocalISO(d)}`;
  })();
  const nextWeekHref = (() => {
    const d = new Date(start);
    d.setDate(d.getDate() + 7);
    return `/calendar?week=${todayLocalISO(d)}`;
  })();

  const monthLabel = start.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const taskId = String(active.id);
    const targetDate = String(over.id);
    const task = localTasks.find((t) => t.id === taskId);
    if (!task) return;
    // Move = update whichever date controls scheduling. when_date takes
    // precedence (matches taskDate()); if the task uses due_date only,
    // shift that instead.
    const usesWhen = task.when_date !== null;
    const current = usesWhen ? task.when_date : task.due_date;
    if (current === targetDate) return;
    const patch = usesWhen
      ? { when_date: targetDate }
      : { due_date: targetDate };
    const next = localTasks.map((t) =>
      t.id === taskId ? { ...t, ...patch } : t
    );
    setLocalTasks(next);
    const api = await getClientTasksApi();
    const { error } = await api.update(taskId, patch);
    if (error) {
      console.error("Move failed:", error);
      setLocalTasks(localTasks);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <DndContext id="week-view-dnd" sensors={sensors} onDragEnd={handleDragEnd}>
      <div>
        <div className="mb-4 flex items-center gap-3">
          <Link
            href={prevWeekHref}
            className="rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
          >
            ←
          </Link>
          <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {monthLabel}
          </h2>
          <Link
            href={nextWeekHref}
            className="rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
          >
            →
          </Link>
          <Link
            href="/calendar"
            className="ml-auto rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
          >
            Today
          </Link>
        </div>

        {/* On phones a 7-day grid can't fit; let it scroll horizontally with
            a sensible minimum column width instead of crushing each day. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[640px]">
        <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b border-neutral-200 dark:border-neutral-800">
          <div />
          {days.map((d) => {
            const isToday = d.getTime() === today.getTime();
            return (
              <div key={d.toISOString()} className="px-2 pb-2 text-center">
                <div className="text-xs uppercase text-neutral-400">
                  {d.toLocaleDateString("en-US", { weekday: "short" })}
                </div>
                <div
                  className={`mt-1 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-semibold ${
                    isToday
                      ? "bg-indigo-500 text-white"
                      : "text-neutral-900 dark:text-neutral-100"
                  }`}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]">
          <div>
            {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => {
              const hour = HOUR_START + i;
              return (
                <div
                  key={hour}
                  className="relative border-r border-neutral-200 pr-2 text-right text-[11px] text-neutral-400 dark:border-neutral-800"
                  style={{ height: HOUR_HEIGHT }}
                >
                  <span className="absolute -top-1.5 right-2">
                    {hour === 0
                      ? "12 AM"
                      : hour < 12
                        ? `${hour} AM`
                        : hour === 12
                          ? "12 PM"
                          : `${hour - 12} PM`}
                  </span>
                </div>
              );
            })}
          </div>

          {days.map((d) => (
            <DayColumn
              key={d.toISOString()}
              day={d}
              tasks={localTasks}
              events={events}
              projectColors={projectColors}
            />
          ))}
        </div>
        </div>
        </div>
      </div>
    </DndContext>
  );
}

function DayColumn({
  day,
  tasks,
  events,
  projectColors,
}: {
  day: Date;
  tasks: Task[];
  events: CalendarEvent[];
  projectColors: Map<string, string>;
}) {
  const dayKey = todayLocalISO(day); // local YYYY-MM-DD, matches stored when_date
  const { setNodeRef, isOver } = useDroppable({ id: dayKey });

  // A task belongs to this day if its effective date (taskDate) lands here.
  const onThisDay = tasks.filter((t) => taskDate(t) === dayKey);
  // Tasks with a specific due_time and duration render as positioned blocks.
  const timed = onThisDay.filter(
    (t) =>
      t.due_time &&
      t.duration_minutes &&
      t.duration_minutes > 0
  );
  // Everything else (no due_time, or no duration) shows in the all-day strip.
  const allDay = onThisDay.filter((t) => !timed.includes(t));

  const eventsToday = calendarEventsOnDay(events, dayKey);
  const allDayEvents = eventsToday.filter((e) => e.all_day);
  const timedEvents = eventsToday.filter((e) => !e.all_day);

  return (
    <div
      ref={setNodeRef}
      className={`relative border-r border-neutral-200 transition-colors dark:border-neutral-800 ${
        isOver ? "bg-indigo-50/40 dark:bg-indigo-950/30" : ""
      }`}
    >
      <div className="min-h-[28px] space-y-0.5 border-b border-neutral-200 bg-neutral-50/60 px-1 py-1 dark:border-neutral-800 dark:bg-neutral-900/40">
        {allDayEvents.map((event) => (
          <AllDayEventChip key={event.id} event={event} />
        ))}
        {allDay.map((task) => (
          <AllDayChip
            key={task.id}
            task={task}
            color={
              (task.project_id && projectColors.get(task.project_id)) ||
              PRIORITY_CONFIG[task.priority].color
            }
          />
        ))}
      </div>

      <div className="relative">
        {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
          <div
            key={i}
            className="border-b border-neutral-100 dark:border-neutral-900"
            style={{ height: HOUR_HEIGHT }}
          />
        ))}

        {timedEvents.map((event) => (
          <EventBlock key={event.id} event={event} />
        ))}

        {timed.map((task) => (
          <TaskBlock
            key={task.id}
            task={task}
            color={
              (task.project_id && projectColors.get(task.project_id)) ||
              PRIORITY_CONFIG[task.priority].color
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A Google Calendar event in the all-day strip. Visually distinct from task
 * chips — dashed border instead of a solid fill — and links out to Google
 * Calendar rather than dragging (events are edited there, not here).
 */
function AllDayEventChip({ event }: { event: CalendarEvent }) {
  const color = event.color ?? EVENT_FALLBACK_COLOR;
  return (
    <a
      href={event.html_link ?? undefined}
      target="_blank"
      rel="noreferrer"
      title={event.calendar_name ?? undefined}
      style={{ borderColor: color, color }}
      className="block break-words rounded-sm border border-dashed px-1.5 py-0.5 text-[11px] font-medium leading-tight hover:opacity-80"
    >
      {event.title}
    </a>
  );
}

/**
 * A timed Google Calendar event positioned on the day grid. Rendered UNDER
 * task blocks (tasks stay grabbable) with a hollow outline treatment so
 * meetings read as context, not to-dos.
 */
function EventBlock({ event }: { event: CalendarEvent }) {
  if (!event.start) return null;

  // Position in the viewer's local timezone, matching the grid's hour labels.
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  const startMin = (start.getHours() - HOUR_START) * 60 + start.getMinutes();
  const durationMin = end
    ? Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000))
    : 60;
  const top = startMin / MIN_PER_PX;
  const height = durationMin / MIN_PER_PX;

  if (top < 0 || top > (HOUR_END - HOUR_START) * HOUR_HEIGHT) return null;

  const color = event.color ?? EVENT_FALLBACK_COLOR;
  const style: React.CSSProperties = {
    top,
    height: Math.max(height, 18),
    borderColor: color,
    backgroundColor: `${color}0d`,
  };

  return (
    <a
      href={event.html_link ?? undefined}
      target="_blank"
      rel="noreferrer"
      title={event.calendar_name ?? undefined}
      style={style}
      className="absolute left-1 right-1 overflow-hidden rounded-md border border-dashed px-2 py-1 text-left text-xs hover:opacity-80"
    >
      <div className="break-words font-medium leading-tight text-neutral-700 dark:text-neutral-200">
        {event.title}
      </div>
      {height > 30 && (
        <div className="mt-0.5 text-[10px] text-neutral-500">
          {formatEventTime(event)}
        </div>
      )}
    </a>
  );
}

function AllDayChip({ task, color }: { task: Task; color: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: task.id });
  const isDone = task.status === "done";
  const style: React.CSSProperties = {
    backgroundColor: `${color}1a`,
    borderLeftColor: color,
    opacity: isDragging ? 0.4 : isDone ? 0.5 : 1,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`cursor-grab break-words rounded-sm border-l-2 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-neutral-800 active:cursor-grabbing dark:text-neutral-100 ${
        isDone ? "line-through" : ""
      }`}
    >
      {task.title}
    </div>
  );
}

function TaskBlock({ task, color }: { task: Task; color: string }) {
  const [expanded, setExpanded] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: task.id });

  if (!task.due_time || !task.duration_minutes) return null;

  const [hh, mm] = task.due_time.split(":").map(Number);
  const startMin = (hh - HOUR_START) * 60 + mm;
  const top = startMin / MIN_PER_PX;
  const height = task.duration_minutes / MIN_PER_PX;

  if (top < 0 || top > (HOUR_END - HOUR_START) * HOUR_HEIGHT) return null;

  const isDone = task.status === "done";
  const opacity = isDone ? 0.5 : 1;

  const style: React.CSSProperties = {
    top,
    height: Math.max(height, 18),
    backgroundColor: `${color}1a`,
    borderLeftColor: color,
    opacity: isDragging ? 0.4 : opacity,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => setExpanded(!expanded)}
      className="absolute left-1 right-1 cursor-grab overflow-hidden rounded-md border-l-2 px-2 py-1 text-left text-xs shadow-sm transition-all hover:z-10 hover:shadow-md active:cursor-grabbing"
    >
      <div
        className={`break-words font-medium leading-tight ${
          isDone ? "line-through" : ""
        } text-neutral-900 dark:text-neutral-100`}
      >
        {task.title}
      </div>
      {height > 30 && (
        <div className="mt-0.5 text-[10px] text-neutral-500">
          {task.due_time} · {task.duration_minutes}m
        </div>
      )}
    </div>
  );
}
