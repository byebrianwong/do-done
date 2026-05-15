"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PRIORITY_CONFIG, STATUS_CONFIG, formatDuration } from "@do-done/shared";
import type { Task, Project, TaskPriority } from "@do-done/shared";
import { formatRrule } from "@do-done/task-engine";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { ScheduleButton } from "./schedule-button";
import { TaskEditModalV2 } from "./task-edit-modal-v2";
import { useUndoToast } from "./undo-toast";

export interface TaskItemProps {
  task: Task;
  projects?: Project[];
}

/**
 * Compact priority indicator: 4 vertical bars with increasing heights.
 * Bars lit count = 5 − priority number (so p1 lights all 4, p4 lights one).
 * Static, non-interactive — the editor uses the bigger PrioritySignal.
 */
function PriorityBars({ priority }: { priority: TaskPriority }) {
  const litCount = { p1: 4, p2: 3, p3: 2, p4: 1 }[priority];
  const color = PRIORITY_CONFIG[priority].color;
  const heights = ["h-1", "h-1.5", "h-2", "h-2.5"];
  return (
    <span
      className="inline-flex items-end gap-[2px]"
      title={`Priority: ${PRIORITY_CONFIG[priority].label}`}
      aria-label={`Priority ${PRIORITY_CONFIG[priority].label}`}
    >
      {[0, 1, 2, 3].map((i) => {
        const lit = i < litCount;
        return (
          <span
            key={i}
            className={`block w-[3px] rounded-[1px] ${heights[i]} ${
              lit ? "" : "bg-neutral-200 dark:bg-neutral-700"
            }`}
            style={lit ? { backgroundColor: color } : undefined}
          />
        );
      })}
    </span>
  );
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

export function TaskItem({ task, projects }: TaskItemProps) {
  const router = useRouter();
  const [completed, setCompleted] = useState(task.status === "done");
  const [hovering, setHovering] = useState(false);
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const toast = useUndoToast();
  const canSchedule = !!task.duration_minutes && !task.due_time;
  const project = task.project_id
    ? projects?.find((p) => p.id === task.project_id)
    : null;
  // STATUS_CONFIG[task.status] can be undefined for an unmigrated DB still
  // serving legacy 'todo' / 'archived' values — guard before reading .color.
  const statusCfg = STATUS_CONFIG[task.status];
  // The checkbox circle now reflects status (not priority). Fall back to a
  // neutral gray if the status is unknown.
  const statusColor = statusCfg?.color ?? "#94a3b8";
  // Show a status text chip for everything that isn't the boring default —
  // the circle color already encodes status, so this is redundant for the
  // default cases. Kept for `next`, `in_progress`, `done`, `cancelled`.
  const showStatusBadge =
    !!statusCfg &&
    task.status !== "not_started" &&
    task.status !== "inbox";

  async function handleToggleComplete(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !completed;
    setCompleted(next);

    const tasks = await getClientTasksApi();
    const { error } = next
      ? await tasks.complete(task.id)
      : await tasks.reopen(task.id);

    if (error) {
      setCompleted(!next);
      console.error("Failed to update task:", error);
      return;
    }

    if (next) {
      toast.show({
        message: `Completed “${task.title}”`,
        undo: async () => {
          const api = await getClientTasksApi();
          await api.reopen(task.id);
          setCompleted(false);
          startTransition(() => router.refresh());
        },
      });
    }

    startTransition(() => router.refresh());
  }

  return (
    <>
      <div
        className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={() => setEditing(true)}
      >
        <button
          onClick={handleToggleComplete}
          className="flex shrink-0 items-center justify-center"
          aria-label={completed ? "Mark incomplete" : "Mark complete"}
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors"
            style={{
              borderColor: completed ? "#d4d4d4" : statusColor,
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

        <PriorityBars priority={task.priority} />

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`text-sm leading-snug ${
              completed
                ? "text-neutral-400 line-through dark:text-neutral-600"
                : "text-neutral-900 dark:text-neutral-100"
            }`}
          >
            {task.title}
          </span>

          {task.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
            >
              {tag}
            </span>
          ))}

          {task.recurrence_rule && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-600 dark:bg-violet-950 dark:text-violet-400"
              title={task.recurrence_rule}
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
              {formatRrule(task.recurrence_rule)}
            </span>
          )}

          {project && (
            <span
              className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400"
              title={`Project: ${project.name}`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              {project.name}
            </span>
          )}

          {task.duration_minutes && (
            <span
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
              title="Time estimate"
            >
              ~{formatDuration(task.duration_minutes)}
            </span>
          )}

          {showStatusBadge && statusCfg && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                color: statusCfg.color,
                backgroundColor: `${statusCfg.color}1a`,
              }}
              title={statusCfg.label}
            >
              {statusCfg.label}
            </span>
          )}
        </div>

        {/* Effective scheduling date: when_date if set (V2 "do date"),
            else due_date (legacy / hard deadline). Show due_date as an
            extra deadline chip when both are set and they differ. */}
        {task.when_date && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${dueDateColor(task.when_date)}`}
            title={`Scheduled for ${task.when_date}`}
          >
            {formatDueDate(task.when_date)}
          </span>
        )}
        {!task.when_date && task.due_date && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${dueDateColor(task.due_date)}`}
            title={`Due ${task.due_date}`}
          >
            {formatDueDate(task.due_date)}
            {task.due_time && ` ${task.due_time}`}
          </span>
        )}
        {task.when_date && task.due_date && task.when_date !== task.due_date && (
          <span
            className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-950 dark:text-red-400"
            title={`Hard deadline ${task.due_date}`}
          >
            due {formatDueDate(task.due_date)}
          </span>
        )}
        {!task.when_date && !task.due_date && task.when_bucket && (
          <span
            className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
            title={`Bucketed as ${task.when_bucket}`}
          >
            {task.when_bucket.replace("_", " ")}
          </span>
        )}

        <div
          className={`flex shrink-0 gap-1 transition-opacity ${
            hovering ? "opacity-100" : "opacity-0"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {canSchedule && task.duration_minutes && (
            <ScheduleButton
              taskId={task.id}
              durationMinutes={task.duration_minutes}
            />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            aria-label="Edit task"
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
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </button>
        </div>
      </div>

      <TaskEditModalV2
        task={task}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </>
  );
}
