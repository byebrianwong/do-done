import type { Task } from "@do-done/shared";

interface TimeSlot {
  start: Date;
  end: Date;
}

interface CalendarEvent {
  start: Date;
  end: Date;
  summary?: string;
}

interface SchedulingPreferences {
  focusHoursStart: number; // 0-23
  focusHoursEnd: number; // 0-23
  timezone: string;
}

export interface ScheduledTask {
  task: Task;
  suggestedSlot: TimeSlot;
}

export function scheduleTasks(
  tasks: Task[],
  calendarEvents: CalendarEvent[],
  preferences: SchedulingPreferences,
  targetDate?: Date
): ScheduledTask[] {
  const date = targetDate ?? new Date();
  const dayStart = new Date(date);
  dayStart.setHours(preferences.focusHoursStart, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(preferences.focusHoursEnd, 0, 0, 0);

  // Build busy slots from calendar events
  const busySlots: TimeSlot[] = calendarEvents
    .filter((e) => e.start < dayEnd && e.end > dayStart)
    .map((e) => ({ start: e.start, end: e.end }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Find free slots
  const freeSlots: TimeSlot[] = [];
  let current = dayStart;
  for (const busy of busySlots) {
    if (current < busy.start) {
      freeSlots.push({ start: new Date(current), end: new Date(busy.start) });
    }
    if (busy.end > current) {
      current = new Date(busy.end);
    }
  }
  if (current < dayEnd) {
    freeSlots.push({ start: new Date(current), end: new Date(dayEnd) });
  }

  // Assign tasks to free slots by priority
  const schedulable = tasks
    .filter(
      (t) =>
        t.duration_minutes &&
        t.status !== "done" &&
        t.status !== "archived"
    )
    .sort((a, b) => {
      const order = { p1: 0, p2: 1, p3: 2, p4: 3 };
      return order[a.priority] - order[b.priority];
    });

  const scheduled: ScheduledTask[] = [];
  const usedSlots: TimeSlot[] = [];

  for (const task of schedulable) {
    const duration = task.duration_minutes! * 60 * 1000;

    for (const slot of freeSlots) {
      const availableStart = findNextAvailable(slot.start, usedSlots);
      if (!availableStart) continue;

      const potentialEnd = new Date(availableStart.getTime() + duration);
      if (potentialEnd <= slot.end) {
        const suggestedSlot = { start: availableStart, end: potentialEnd };
        scheduled.push({ task, suggestedSlot });
        usedSlots.push(suggestedSlot);
        break;
      }
    }
  }

  return scheduled;
}

function findNextAvailable(
  slotStart: Date,
  usedSlots: TimeSlot[]
): Date | null {
  let candidate = new Date(slotStart);
  for (const used of usedSlots) {
    if (candidate >= used.start && candidate < used.end) {
      candidate = new Date(used.end);
    }
  }
  return candidate;
}
