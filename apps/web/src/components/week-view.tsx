"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Task, Project } from "@do-done/shared";
import { PRIORITY_CONFIG } from "@do-done/shared";

interface WeekViewProps {
  weekStart: string; // ISO
  tasks: Task[];
  projects: Project[];
}

const HOUR_START = 6;
const HOUR_END = 22; // exclusive
const HOUR_HEIGHT = 48; // px
const MIN_PER_PX = 60 / HOUR_HEIGHT; // 1.25 minutes per pixel

export function WeekView({ weekStart, tasks, projects }: WeekViewProps) {
  const start = useMemo(() => new Date(weekStart), [weekStart]);
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
    return `/calendar?week=${d.toISOString().split("T")[0]}`;
  })();
  const nextWeekHref = (() => {
    const d = new Date(start);
    d.setDate(d.getDate() + 7);
    return `/calendar?week=${d.toISOString().split("T")[0]}`;
  })();

  const monthLabel = start.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      {/* Week navigator */}
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

      {/* Header row */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-neutral-200 dark:border-neutral-800">
        <div />
        {days.map((d) => {
          const isToday = d.getTime() === today.getTime();
          return (
            <div
              key={d.toISOString()}
              className="px-2 pb-2 text-center"
            >
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

      {/* Grid body */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)]">
        {/* Hour labels column */}
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

        {/* Day columns */}
        {days.map((d) => (
          <DayColumn
            key={d.toISOString()}
            day={d}
            tasks={tasks}
            projectColors={projectColors}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  tasks,
  projectColors,
}: {
  day: Date;
  tasks: Task[];
  projectColors: Map<string, string>;
}) {
  const dayKey = day.toISOString().split("T")[0];

  const dayTasks = tasks.filter(
    (t) =>
      t.due_date === dayKey &&
      t.due_time &&
      t.duration_minutes &&
      t.duration_minutes > 0
  );

  return (
    <div className="relative border-r border-neutral-200 dark:border-neutral-800">
      {/* Hour grid lines */}
      {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
        <div
          key={i}
          className="border-b border-neutral-100 dark:border-neutral-900"
          style={{ height: HOUR_HEIGHT }}
        />
      ))}

      {/* Tasks as blocks */}
      {dayTasks.map((task) => (
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
  );
}

function TaskBlock({ task, color }: { task: Task; color: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!task.due_time || !task.duration_minutes) return null;

  const [hh, mm] = task.due_time.split(":").map(Number);
  const startMin = (hh - HOUR_START) * 60 + mm;
  const top = startMin / MIN_PER_PX;
  const height = task.duration_minutes / MIN_PER_PX;

  if (top < 0 || top > (HOUR_END - HOUR_START) * HOUR_HEIGHT) return null;

  const isDone = task.status === "done";
  const opacity = isDone ? 0.5 : 1;

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="absolute left-1 right-1 overflow-hidden rounded-md border-l-2 px-2 py-1 text-left text-xs shadow-sm transition-all hover:z-10 hover:shadow-md"
      style={{
        top,
        height: Math.max(height, 18),
        backgroundColor: `${color}1a`, // 10% alpha
        borderLeftColor: color,
        opacity,
      }}
    >
      <div
        className={`truncate font-medium ${
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
    </button>
  );
}
