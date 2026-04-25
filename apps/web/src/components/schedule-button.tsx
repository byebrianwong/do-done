"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getClientTasksApi } from "@/lib/supabase/tasks-client";

interface Slot {
  start: string;
  end: string;
}

export function ScheduleButton({
  taskId,
  durationMinutes,
}: {
  taskId: string;
  durationMinutes: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function loadSlots() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/suggest-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load slots");
      } else {
        setSlots(data.slots ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function pickSlot(slot: Slot) {
    const start = new Date(slot.start);
    const yyyy = start.getFullYear();
    const mm = String(start.getMonth() + 1).padStart(2, "0");
    const dd = String(start.getDate()).padStart(2, "0");
    const hh = String(start.getHours()).padStart(2, "0");
    const min = String(start.getMinutes()).padStart(2, "0");

    const tasks = await getClientTasksApi();
    await tasks.update(taskId, {
      due_date: `${yyyy}-${mm}-${dd}`,
      due_time: `${hh}:${min}`,
      duration_minutes: durationMinutes,
    });
    setOpen(false);
    startTransition(() => router.refresh());
  }

  function handleToggle() {
    if (!open) loadSlots();
    setOpen(!open);
  }

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-indigo-500 dark:hover:bg-neutral-800"
        aria-label="Suggest a time"
        title="Find a time"
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
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-1 px-2 py-1 text-xs font-medium text-neutral-500">
            Suggested slots ({durationMinutes}m)
          </div>
          {loading && (
            <div className="px-2 py-3 text-xs text-neutral-400">Searching...</div>
          )}
          {error && (
            <div className="px-2 py-2 text-xs text-red-500">{error}</div>
          )}
          {!loading && !error && slots.length === 0 && (
            <div className="px-2 py-3 text-xs text-neutral-400">
              No free slots in the next 5 days within focus hours.
            </div>
          )}
          {slots.map((slot) => {
            const start = new Date(slot.start);
            const dayLabel = start.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const timeLabel = start.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
            return (
              <button
                key={slot.start}
                onClick={() => pickSlot(slot)}
                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs hover:bg-indigo-50 dark:hover:bg-indigo-950"
              >
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {dayLabel}
                </span>
                <span className="text-indigo-600 dark:text-indigo-400">
                  {timeLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
