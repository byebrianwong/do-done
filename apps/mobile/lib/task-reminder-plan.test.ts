import { describe, expect, it } from 'vitest';
import {
  NotificationSettingsSchema,
  type NotificationSettings,
  type Task,
} from '@do-done/shared';
import { MIN_LEAD_MS } from './digest-plan';
import {
  MAX_TASK_REMINDERS,
  planTaskReminders,
  reminderQueryRange,
} from './task-reminder-plan';

function settings(over: Partial<NotificationSettings> = {}): NotificationSettings {
  return NotificationSettingsSchema.parse({
    notify_task_reminders: true,
    ...over,
  });
}

let seq = 0;
function task(over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
    user_id: '00000000-0000-0000-0000-000000000002',
    title: `Task ${seq}`,
    description: null,
    status: 'not_started',
    priority: 'p4',
    project_id: null,
    scheduled_date: null,
    scheduled_time: null,
    deadline_date: null,
    deadline_time: null,
    duration_minutes: null,
    recurrence_rule: null,
    calendar_event_id: null,
    tags: [],
    parent_task_id: null,
    depth: 0,
    sort_order: 0,
    focus_override: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    completed_at: null,
    ...over,
  } as Task;
}

// 2026-08-15 is a Saturday. 06:00 UTC is 02:00 in New York (EDT, UTC−4), so
// "today" in NY is still the 15th and the whole day is ahead.
const SAT_06Z = new Date('2026-08-15T06:00:00Z');
const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

describe('planTaskReminders', () => {
  it('plans nothing while the switch is off', () => {
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-15', scheduled_time: '14:00' })],
      settings({ notify_task_reminders: false }),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toEqual([]);
  });

  it('arms a timed task at its own time, in the user timezone', () => {
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-15', scheduled_time: '14:00' })],
      settings(),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toHaveLength(1);
    // 14:00 EDT is 18:00Z.
    expect(plan.occurrences[0].at.toISOString()).toBe('2026-08-15T18:00:00.000Z');
    expect(plan.occurrences[0].kind).toBe('task');
  });

  it('resolves the time in the account timezone, not the process clock', () => {
    // The same wall clock in Tokyo (UTC+9) is a different instant entirely. If
    // this ever reads the device zone instead, it is wrong by hours for anyone
    // travelling — and silently. The 16th, because 14:00 on the 15th in Tokyo
    // has already gone by at SAT_06Z (which is 15:00 there).
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-16', scheduled_time: '14:00' })],
      settings(),
      { now: SAT_06Z, timeZone: TOKYO }
    );
    expect(plan.occurrences[0].at.toISOString()).toBe('2026-08-16T05:00:00.000Z');
  });

  it('applies the lead time', () => {
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-15', scheduled_time: '14:00' })],
      settings({ notify_task_reminder_lead_minutes: 30 }),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences[0].at.toISOString()).toBe('2026-08-15T17:30:00.000Z');
  });

  it('never arms an instant that has already passed', () => {
    // A re-arm cancels and recreates, so a past instant would be delivered
    // immediately — a 9am reminder arriving at 2pm because the app was opened.
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-15', scheduled_time: '01:00' })],
      settings(),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toEqual([]);
  });

  it('leaves the MIN_LEAD_MS gap so a re-arm cannot fire what it just cancelled', () => {
    const now = new Date('2026-08-15T18:00:00Z'); // 14:00 in NY
    const soon = new Date(now.getTime() + MIN_LEAD_MS / 2);
    const hh = String(soon.getUTCHours() - 4).padStart(2, '0');
    const mm = String(soon.getUTCMinutes()).padStart(2, '0');
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-15', scheduled_time: `${hh}:${mm}` })],
      settings(),
      { now, timeZone: NY }
    );
    expect(plan.occurrences).toEqual([]);
  });

  it('skips tasks past the horizon', () => {
    const plan = planTaskReminders(
      [
        task({ scheduled_date: '2026-08-16', scheduled_time: '09:00' }),
        task({ scheduled_date: '2026-09-30', scheduled_time: '09:00' }),
      ],
      settings(),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toHaveLength(1);
  });

  it('keeps a lead that pushes the reminder into the previous day', () => {
    // The horizon bounds the task's day, not the shifted instant, so a task at
    // 00:30 on the first day still gets its heads-up the night before.
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-16', scheduled_time: '00:30' })],
      settings({ notify_task_reminder_lead_minutes: 60 }),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toHaveLength(1);
    // 23:30 EDT on the 15th = 03:30Z on the 16th.
    expect(plan.occurrences[0].at.toISOString()).toBe('2026-08-16T03:30:00.000Z');
  });

  it('skips overdue work — its day already came', () => {
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-01', scheduled_time: '09:00' })],
      settings(),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toEqual([]);
  });

  it('never arms a shopping-list item', () => {
    const plan = planTaskReminders(
      [
        task({
          scheduled_date: '2026-08-15',
          scheduled_time: '14:00',
          is_list_item: true,
        }),
      ],
      settings(),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toEqual([]);
  });

  it('arms a deadline-only task at its deadline time', () => {
    const plan = planTaskReminders(
      [task({ deadline_date: '2026-08-15', deadline_time: '17:00' })],
      settings(),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toHaveLength(1);
    expect(plan.occurrences[0].at.toISOString()).toBe('2026-08-15T21:00:00.000Z');
  });
});

describe('the day-start roundup', () => {
  it('arms one occurrence per day that has untimed work', () => {
    const plan = planTaskReminders(
      [
        task({ scheduled_date: '2026-08-15' }),
        task({ scheduled_date: '2026-08-15' }),
        task({ scheduled_date: '2026-08-16' }),
      ],
      settings({ notify_day_start_time: '09:00' }),
      { now: SAT_06Z, timeZone: NY }
    );
    // Two days, not three tasks: one notification per day is the rule.
    expect(plan.occurrences).toHaveLength(2);
    expect(plan.occurrences.every((o) => o.kind === 'day-start')).toBe(true);
    expect(plan.occurrences[0].at.toISOString()).toBe('2026-08-15T13:00:00.000Z');
  });

  it('arms nothing for a day whose tasks all carry a time', () => {
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-16', scheduled_time: '09:00' })],
      settings(),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences.filter((o) => o.kind === 'day-start')).toEqual([]);
  });

  it('is skipped entirely when the roundup is switched off', () => {
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-16' })],
      settings({ notify_day_start_roundup: false }),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.occurrences).toEqual([]);
  });

  it("does not arm today's roundup once its time has gone by", () => {
    const noon = new Date('2026-08-15T16:00:00Z'); // 12:00 in NY
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-15' }), task({ scheduled_date: '2026-08-16' })],
      settings({ notify_day_start_time: '09:00' }),
      { now: noon, timeZone: NY }
    );
    expect(plan.occurrences).toHaveLength(1);
    expect((plan.occurrences[0] as { dateISO: string }).dateISO).toBe('2026-08-16');
  });
});

describe('the cap', () => {
  it('keeps the soonest and reports what it dropped', () => {
    // 60 timed tasks across two days, all inside the horizon.
    const many = Array.from({ length: 60 }, (_, i) =>
      task({
        scheduled_date: i < 30 ? '2026-08-16' : '2026-08-17',
        scheduled_time: `${String(6 + (i % 12)).padStart(2, '0')}:00`,
      })
    );
    const plan = planTaskReminders(many, settings(), {
      now: SAT_06Z,
      timeZone: NY,
    });
    expect(plan.occurrences).toHaveLength(MAX_TASK_REMINDERS);
    expect(plan.dropped).toBe(60 - MAX_TASK_REMINDERS);
    // What survives is the soonest, so the tail that was cut is the part with
    // the most chances to be armed by a later re-arm.
    const times = plan.occurrences.map((o) => o.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const kept = Math.max(...times);
    const cutoff = Math.min(
      ...many
        .map((t) =>
          new Date(`${t.scheduled_date}T${t.scheduled_time}:00Z`).getTime()
        )
        .filter((ms) => ms > kept)
    );
    expect(cutoff).toBeGreaterThan(kept);
  });

  it('reports nothing dropped when everything fits', () => {
    const plan = planTaskReminders(
      [task({ scheduled_date: '2026-08-16', scheduled_time: '09:00' })],
      settings(),
      { now: SAT_06Z, timeZone: NY }
    );
    expect(plan.dropped).toBe(0);
  });

  it('honours a caller-supplied cap', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      task({
        scheduled_date: '2026-08-16',
        scheduled_time: `${String(9 + i).padStart(2, '0')}:00`,
      })
    );
    const plan = planTaskReminders(many, settings(), {
      now: SAT_06Z,
      timeZone: NY,
      max: 2,
    });
    expect(plan.occurrences).toHaveLength(2);
    expect(plan.dropped).toBe(3);
  });
});

describe('reminderQueryRange', () => {
  it('starts at today in the user timezone', () => {
    expect(reminderQueryRange(NY, SAT_06Z, 3)).toEqual({
      startISO: '2026-08-15',
      endISO: '2026-08-17',
    });
  });

  it('reads the day from the account zone, not UTC', () => {
    // 2026-08-15T22:00Z is already the 16th in Tokyo.
    const late = new Date('2026-08-15T22:00:00Z');
    expect(reminderQueryRange(TOKYO, late, 1).startISO).toBe('2026-08-16');
  });
});
