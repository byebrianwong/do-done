"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PRIORITY_CONFIG } from "@do-done/shared";
import type { TaskPriority } from "@do-done/shared";
import { formatRrule } from "@do-done/task-engine";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { ScheduleButton } from "./schedule-button";

export interface TaskItemProps {
  id: string;
  title: string;
  priority: TaskPriority;
  dueDate?: string | null;
  dueTime?: string | null;
  durationMinutes?: number | null;
  completed?: boolean;
  tags?: string[];
  recurrenceRule?: string | null;
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return "Today";
  if (date.getTime() === tomorrow.getTime()) return "Tomorrow";

  const diff = Math.ceil(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return "Overdue";
  if (diff <= 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dueDateColor(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return "text-red-500 bg-red-50 dark:bg-red-950";
  if (date.getTime() === today.getTime())
    return "text-orange-600 bg-orange-50 dark:bg-orange-950";
  return "text-neutral-500 bg-neutral-100 dark:bg-neutral-800";
}

export function TaskItem({
  id,
  title,
  priority,
  dueDate,
  dueTime = null,
  durationMinutes = null,
  completed: initialCompleted = false,
  tags = [],
  recurrenceRule = null,
}: TaskItemProps) {
  const canSchedule = !!durationMinutes && !dueTime;
  const router = useRouter();
  const [completed, setCompleted] = useState(initialCompleted);
  const [hovering, setHovering] = useState(false);
  const [, startTransition] = useTransition();
  const priorityColor = PRIORITY_CONFIG[priority].color;

  async function handleToggleComplete() {
    const next = !completed;
    setCompleted(next); // optimistic

    const tasks = await getClientTasksApi();
    const { error } = next
      ? await tasks.complete(id)
      : await tasks.update(id, { status: "todo" });

    if (error) {
      setCompleted(!next); // revert
      console.error("Failed to update task:", error);
      return;
    }

    startTransition(() => router.refresh());
  }

  async function handleDelete() {
    if (!confirm("Delete this task?")) return;
    const tasks = await getClientTasksApi();
    // soft-delete via archive
    const { error } = await tasks.update(id, { status: "archived" });
    if (error) {
      console.error("Failed to delete:", error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        onClick={handleToggleComplete}
        className="flex shrink-0 items-center justify-center"
        aria-label={completed ? "Mark incomplete" : "Mark complete"}
      >
        <span
          className="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors"
          style={{
            borderColor: completed ? "#d4d4d4" : priorityColor,
            backgroundColor: completed ? "#d4d4d4" : "transparent",
          }}
        >
          {completed && (
            <svg
              className="h-3 w-3 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
        </span>
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={`text-sm leading-snug ${
            completed
              ? "text-neutral-400 line-through dark:text-neutral-600"
              : "text-neutral-900 dark:text-neutral-100"
          }`}
        >
          {title}
        </span>

        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
          >
            {tag}
          </span>
        ))}

        {recurrenceRule && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-600 dark:bg-violet-950 dark:text-violet-400"
            title={recurrenceRule}
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {formatRrule(recurrenceRule)}
          </span>
        )}
      </div>

      {dueDate && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${dueDateColor(dueDate)}`}
        >
          {formatDueDate(dueDate)}
        </span>
      )}

      <div
        className={`flex shrink-0 gap-1 transition-opacity ${
          hovering ? "opacity-100" : "opacity-0"
        }`}
      >
        {canSchedule && durationMinutes && (
          <ScheduleButton taskId={id} durationMinutes={durationMinutes} />
        )}
        <button
          onClick={handleDelete}
          className="rounded p-1 text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950 dark:hover:text-red-400"
          aria-label="Delete task"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
