"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Task, Project } from "@do-done/shared";
import {
  PRIORITY_CONFIG,
  addDaysLocalISO,
  resolveQuickSchedule,
  todayLocalISO,
} from "@do-done/shared";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";
import { buildRescheduleInput } from "@/lib/reschedule";
import { LinkifiedText } from "./linkified-text";

export interface OverdueSectionProps {
  tasks: Task[];
  projects?: Project[];
}

function OverdueRow({
  task,
  onSelect,
}: {
  task: Task;
  onSelect: (target: Parameters<typeof buildRescheduleInput>[1]) => void;
}) {
  const priorityColor = PRIORITY_CONFIG[task.priority].color;
  const lateBy =
    task.when_date && task.when_date < todayLocalISO()
      ? task.when_date
      : task.due_date && task.due_date < todayLocalISO()
      ? task.due_date
      : null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-900">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: priorityColor }}
      />
      <span className="min-w-0 flex-1 truncate text-sm text-neutral-900 dark:text-neutral-100">
        <LinkifiedText text={task.title} />
      </span>
      {lateBy && (
        <span className="text-xs text-red-500" title={`Was ${lateBy}`}>
          {lateBy}
        </span>
      )}
      <div className="flex flex-wrap justify-end gap-1">
        <button
          type="button"
          onClick={() => onSelect({ kind: "date", date: todayLocalISO() })}
          className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onSelect({ kind: "date", date: addDaysLocalISO(1) })}
          className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          Tomorrow
        </button>
        <button
          type="button"
          onClick={() =>
            onSelect({ kind: "date", date: resolveQuickSchedule("this_week") })
          }
          className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
        >
          This week
        </button>
        <DatePickerChip
          value={task.when_date ?? task.due_date ?? todayLocalISO()}
          onPick={(date) => onSelect({ kind: "date", date })}
        />
        <button
          type="button"
          onClick={() => onSelect({ kind: "remove" })}
          className="rounded-full px-2.5 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          title="Remove dates"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function DatePickerChip({
  value,
  onPick,
}: {
  value: string;
  onPick: (date: string) => void;
}) {
  return (
    <label className="cursor-pointer rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700">
      Pick…
      <input
        type="date"
        defaultValue={value}
        min={todayLocalISO()}
        onChange={(e) => onPick(e.target.value)}
        className="sr-only"
      />
    </label>
  );
}

export function OverdueSection({ tasks }: OverdueSectionProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  if (tasks.length === 0) return null;
  const visible = tasks.filter((t) => !hidden.has(t.id));
  if (visible.length === 0) return null;

  async function applyOne(
    task: Task,
    target: Parameters<typeof buildRescheduleInput>[1]
  ) {
    setBusy(true);
    const api = await getClientTasksApi();
    const { error } = await api.update(
      task.id,
      buildRescheduleInput(task, target)
    );
    setBusy(false);
    if (error) {
      console.error("Reschedule failed:", error);
      return;
    }
    setHidden((prev) => new Set(prev).add(task.id));
    startTransition(() => router.refresh());
  }

  async function rescheduleAll(date: string) {
    setBusy(true);
    const api = await getClientTasksApi();
    const target = { kind: "date" as const, date };
    const updates = visible.map((t) => ({
      id: t.id,
      input: buildRescheduleInput(t, target),
    }));
    const { error } = await api.bulkUpdate(updates);
    setBusy(false);
    if (error) {
      console.error("Bulk reschedule failed:", error);
      return;
    }
    setHidden((prev) => {
      const next = new Set(prev);
      visible.forEach((t) => next.add(t.id));
      return next;
    });
    startTransition(() => router.refresh());
  }

  return (
    <section className="mb-6 rounded-xl border border-red-100 bg-red-50/40 p-3 dark:border-red-950/60 dark:bg-red-950/20">
      <header className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-400"
        >
          <svg
            className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
          Overdue ({visible.length})
        </button>
        <div className="flex items-center gap-1.5">
          <span className="hidden text-xs font-medium text-red-700/70 sm:inline dark:text-red-400/70">
            Reschedule all
          </span>
          <button
            type="button"
            onClick={() => rescheduleAll(todayLocalISO())}
            disabled={busy}
            className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => rescheduleAll(addDaysLocalISO(1))}
            disabled={busy}
            className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900"
          >
            Tomorrow
          </button>
          <button
            type="button"
            onClick={() => rescheduleAll(resolveQuickSchedule("next_week"))}
            disabled={busy}
            className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900"
          >
            Next week
          </button>
        </div>
      </header>
      {open && (
        <div className="space-y-0.5">
          {visible.map((task) => (
            <OverdueRow
              key={task.id}
              task={task}
              onSelect={(target) => applyOne(task, target)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
